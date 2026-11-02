// Default is a local dry-run. Explicit execute mode touches only one new tagged test project.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";
import { analyzeWorkflowDefinition } from "../server/workflow-compiler.ts";
import { makeTypedSortFixture } from "./typed-sort-fixture.ts";

const base = "http://124.223.198.84:1180/";
const execute = process.env.FLOW_TYPED_SORT_EXECUTE === "1";
const recovery = process.env.FLOW_TYPED_SORT_CLEANUP_TAG;
const tag = recovery ?? `TSORT_${randomBytes(6).toString("hex").toUpperCase()}`;
assert(/^TSORT_[A-F0-9]{12}$/.test(tag));
const plan = makeTypedSortFixture("synthetic_asset");
assert.equal(plan.rows.length, 23);
assert.equal(plan.definition.nodes.length, 6);
assert.equal(
  analyzeWorkflowDefinition(plan.definition, { flowType: "data" }).ok,
  true
);
console.log(
  JSON.stringify({
    stage: "scope",
    tag,
    execute,
    recovery: Boolean(recovery),
    projects: 1,
    sources: 1,
    assets: 1,
    workflows: 1,
    runs: 1,
    accounts: 0,
    grants: 0,
    rows: 23,
    resultSets: 2,
  })
);
if (execute) {
  assert(
    process.env.FLOW_TYPED_SORT_EXPECTED_BUILD,
    "Pin the deployed build before execution"
  );
  assert.equal(
    process.env.BUILD_ID,
    process.env.FLOW_TYPED_SORT_EXPECTED_BUILD
  );
  await main();
}

async function main() {
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  let cookie = "",
    actor,
    project;
  const workflows = new Set();
  const creations = new Map();
  const createMethods = new Set([
    "project.create",
    "data.createSource",
    "data.createAsset",
    "project.createWorkflow",
    "data.run",
  ]);
  const mutations = new Set([
    "auth.login",
    ...createMethods,
    "project.auditWorkflow",
    "workflow.publish",
    "workflow.delete",
    "data.updateAsset",
    "data.updateSource",
    "project.changeStatus",
  ]);
  async function sql(query, params = []) {
    assert(/^SELECT\b/.test(query), "Only read-only, scoped SQL is permitted");
    return (await db.query(query, params))[0];
  }
  async function api(method, input, mutation = false) {
    if (mutation) {
      assert(mutations.has(method));
      if (createMethods.has(method)) {
        assert(!recovery, "Recovery must never create fixtures or run again");
        assert(!creations.has(method), "Do not retry an ambiguous creation");
        creations.set(method, 1);
      }
      if (method === "project.create")
        assert.deepEqual(input, { code: tag, name: `排序隔离_${tag}` });
      else if (method !== "auth.login") {
        assert(project);
        if (["workflow.publish", "workflow.delete"].includes(method))
          assert(workflows.has(input.id));
        else {
          assert.equal(input.projectId, project.id);
          if (input.workflowId) assert(workflows.has(input.workflowId));
        }
      }
    }
    const body = JSON.stringify(superjson.serialize(input));
    const response = await fetch(
      base +
        "api/trpc/" +
        method +
        (mutation ? "" : "?input=" + encodeURIComponent(body)),
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie },
        ...(mutation ? { body } : {}),
        signal: AbortSignal.timeout(25000),
      }
    );
    const next = response.headers.getSetCookie()[0];
    if (next) cookie = next.split(";", 1)[0];
    const payload = await response.json();
    assert(
      response.ok && !payload.error,
      `${method}: ${payload.error?.json?.message ?? response.status}`
    );
    return superjson.deserialize(payload.result.data);
  }
  async function wait(runId) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const run = await api("data.runDetail", { projectId: project.id, runId });
      if (["success", "failed", "cancelled"].includes(run.status)) return run;
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    throw new Error(
      "Isolated run is not terminal; preserve fixtures and use cleanup recovery after it ends"
    );
  }
  async function cleanup() {
    const projects = await sql(
      "SELECT id,name,ownerUserId,status,lifecycleVersion FROM flow_project WHERE code=?",
      [tag]
    );
    assert(projects.length <= 1);
    if (!projects.length) return;
    project = projects[0];
    assert.equal(project.name, `排序隔离_${tag}`);
    assert.equal(Number(project.ownerUserId), actor.id);
    const flows = await sql(
      "SELECT id,name,ownerUserId FROM workflow WHERE projectId=?",
      [project.id]
    );
    assert(flows.length <= 1);
    for (const flow of flows) {
      assert.equal(flow.name, `混合排序_${tag}`);
      assert.equal(Number(flow.ownerUserId), actor.id);
      workflows.add(flow.id);
    }
    const runs = await api("data.runs", {
      projectId: project.id,
      limit: 10,
      summaryOnly: true,
    });
    assert(runs.length <= 1);
    for (const run of runs) {
      assert(workflows.has(run.workflowId));
      if (!["success", "failed", "cancelled"].includes(run.status))
        await wait(run.id);
    }
    for (const flow of flows) {
      const current = await api("workflow.get", { id: flow.id });
      if (!current.archivedAt)
        await api(
          "workflow.delete",
          {
            id: flow.id,
            expectedDefinitionVersion: Number(current.definitionVersion),
            expectedConfigurationToken: current.configurationToken,
          },
          true
        );
    }
    const assets = await sql(
      "SELECT id,status,name FROM data_asset WHERE projectId=?",
      [project.id]
    );
    assert(assets.length <= 1);
    for (const asset of assets) {
      assert.equal(asset.name, `排序样本_${tag}`);
      if (asset.status !== "disabled")
        await api(
          "data.updateAsset",
          { projectId: project.id, assetId: asset.id, status: "disabled" },
          true
        );
    }
    const sources = await sql(
      "SELECT id,status,name,sourceType FROM data_source WHERE projectId=?",
      [project.id]
    );
    assert(sources.length <= 1);
    for (const source of sources) {
      assert.equal(source.sourceType, "inline");
      assert.equal(source.name, `排序内联源_${tag}`);
      if (source.status !== "disabled")
        await api(
          "data.updateSource",
          { projectId: project.id, sourceId: source.id, status: "disabled" },
          true
        );
    }
    const [latest] = await sql(
      "SELECT status,lifecycleVersion FROM flow_project WHERE id=?",
      [project.id]
    );
    if (latest.status !== "archived")
      await api(
        "project.changeStatus",
        {
          projectId: project.id,
          status: "archived",
          expectedVersion: Number(latest.lifecycleVersion),
          expectedWorkflowCount: 0,
        },
        true
      );
    const [remaining] = await sql(
      "SELECT (SELECT COUNT(*) FROM workflow WHERE projectId=? AND archivedAt IS NULL) AS flows,(SELECT COUNT(*) FROM data_asset WHERE projectId=? AND status<>'disabled') AS assets,(SELECT COUNT(*) FROM data_source WHERE projectId=? AND status<>'disabled') AS sources,(SELECT COUNT(*) FROM dataflow_run WHERE projectId=? AND status IN ('queued','running')) AS runs",
      [project.id, project.id, project.id, project.id]
    );
    assert.deepEqual(
      { ...remaining },
      { flows: 0, assets: 0, sources: 0, runs: 0 }
    );
    console.log(
      JSON.stringify({
        stage: "cleanup",
        tag,
        projectId: project.id,
        cleanupComplete: true,
        historyRetained: true,
      })
    );
  }
  try {
    assert(
      process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME &&
        process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD
    );
    await api(
      "auth.login",
      {
        username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
        password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
      },
      true
    );
    actor = await api("auth.me", undefined);
    assert.equal(actor.role, "admin");
    if (!recovery) {
      project = await api(
        "project.create",
        { code: tag, name: `排序隔离_${tag}` },
        true
      );
      console.log(
        JSON.stringify({ stage: "created", tag, projectId: project.id })
      );
      const source = await api(
        "data.createSource",
        {
          projectId: project.id,
          name: `排序内联源_${tag}`,
          sourceType: "inline",
          connection: {},
        },
        true
      );
      const asset = await api(
        "data.createAsset",
        {
          projectId: project.id,
          sourceId: source.id,
          name: `排序样本_${tag}`,
          assetType: "dataset",
          schema: [
            { name: "id", type: "string" },
            { name: "group", type: "string" },
            { name: "v", type: "json" },
            { name: "tie", type: "number" },
          ],
          sample: plan.rows,
        },
        true
      );
      const fixture = makeTypedSortFixture(asset.id);
      const flow = await api(
        "project.createWorkflow",
        {
          projectId: project.id,
          name: `混合排序_${tag}`,
          flowType: "data",
          definition: fixture.definition,
        },
        true
      );
      workflows.add(flow.id);
      const draft = await api("workflow.get", { id: flow.id });
      await api(
        "project.auditWorkflow",
        {
          projectId: project.id,
          workflowId: flow.id,
          auditStatus: "approved",
          expectedDefinitionVersion: Number(draft.definitionVersion),
          expectedAuditStatus: draft.auditStatus,
        },
        true
      );
      await api(
        "workflow.publish",
        {
          id: flow.id,
          expectedDefinitionVersion: Number(draft.definitionVersion),
        },
        true
      );
      const published = await api("workflow.get", { id: flow.id });
      const started = await api(
        "data.run",
        {
          projectId: project.id,
          workflowId: flow.id,
          expectedDefinitionVersion: Number(published.definitionVersion),
        },
        true
      );
      const run = await wait(started.runId ?? started.id);
      assert.equal(run.status, "success");
      assert.equal(run.executionSource, "published_plan");
      assert.equal(run.definitionVersion, Number(published.definitionVersion));
      assert.equal(run.nodeRuns.length, 6);
      assert(
        run.nodeRuns.every(
          node =>
            (node.status === "success" && node.rowCount === 23) ||
            (node.nodeId === "start" && node.status === "success")
        )
      );
      assert.equal(run.output.terminals.length, 2);
      for (const [nodeId, ids] of Object.entries(fixture.expected)) {
        const terminal = run.output.terminals.find(
          item => item.nodeId === nodeId
        );
        assert(terminal, `Missing result set ${nodeId}`);
        assert.deepEqual(
          terminal.rows.map(row => row.id),
          ids
        );
      }
      console.log(
        JSON.stringify({
          stage: "accepted",
          tag,
          projectId: project.id,
          workflowId: flow.id,
          runId: run.id,
          rows: 23,
          resultSets: 2,
          status: run.status,
          publishedVersion: run.definitionVersion,
          matchedExpected: true,
        })
      );
    }
  } finally {
    try {
      if (actor) await cleanup();
    } catch (error) {
      console.log(
        JSON.stringify({
          stage: "cleanup",
          tag,
          projectId: project?.id,
          cleanupComplete: false,
          recoveryRequired: true,
        })
      );
      throw error;
    } finally {
      await db.end();
    }
  }
}
