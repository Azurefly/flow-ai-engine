// Run the bundled script inside the app container. All HTTP stays on the approved 1180 service.
// SQL is read-only. Writes are limited to one newly created, tagged project; no accounts or grants.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";
import { inspectDataflowConfigConversion } from "../shared/dataflow-config-conversion.ts";
import { analyzeWorkflowDefinition } from "../server/workflow-compiler.ts";
import { dataflowResourceDiagnostics } from "../server/dataflow-resource-readiness.ts";

const base = "http://124.223.198.84:1180/";
const observe = process.env.FLOW_CONVERTED_RUNTIME_OBSERVE === "1";
const tag =
  process.env.FLOW_CONVERTED_RUNTIME_CLEANUP_TAG ??
  `DFCONV_${randomBytes(6).toString("hex").toUpperCase()}`;
assert(/^DFCONV_[A-F0-9]{12}$/.test(tag), "Invalid isolated cleanup tag");
const parse = value => (typeof value === "string" ? JSON.parse(value) : value);
const digest = value =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "undefined")
    .digest("hex");
const report = value => console.log(JSON.stringify(value));
const db = await mysql.createConnection(process.env.DATABASE_URL);
let cookie = "",
  actor,
  project;
const ownedWorkflows = new Set();
const mutations = new Set([
  "auth.login",
  "project.create",
  "data.createSource",
  "data.createAsset",
  "project.createWorkflow",
  "project.auditWorkflow",
  "workflow.publish",
  "data.run",
  "workflow.delete",
  "data.updateAsset",
  "data.updateSource",
  "project.changeStatus",
]);

async function api(method, input, mutation = false) {
  if (mutation) {
    assert(
      mutations.has(method),
      `Mutation is outside the acceptance scope: ${method}`
    );
    if (!["auth.login", "project.create"].includes(method)) {
      assert(project, "Isolated project not resolved");
      if (["workflow.publish", "workflow.delete"].includes(method))
        assert(ownedWorkflows.has(input.id));
      else {
        assert.equal(input.projectId, project.id);
        if (input.workflowId) assert(ownedWorkflows.has(input.workflowId));
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

async function readRows(sql, parameters = []) {
  assert(/^\s*(SELECT|WITH)\b/i.test(sql), "SQL writes are forbidden");
  return (await db.query(sql, parameters))[0];
}

async function publishedSources() {
  return readRows(
    "SELECT w.id,w.projectId,w.name,w.definitionVersion,w.definitionJson,w.publishedExecutionPlanJson FROM workflow w JOIN flow_project p ON p.id=w.projectId AND p.status='active' WHERE w.flowType='data' AND w.status='published' AND w.archivedAt IS NULL ORDER BY w.id"
  );
}

async function waitForRun(runId) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const current = await api("data.runDetail", {
      projectId: project.id,
      runId,
    });
    if (["success", "failed"].includes(current.status)) return current;
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  throw new Error(`Isolated run has not reached a terminal state: ${runId}`);
}

// Independent SQL oracle for these three inventoried models, not the product row operators.
async function expectedOutput(definition, assets) {
  const aggregates = definition.nodes.filter(node => node.type === "aggregate");
  const join = definition.nodes.find(node => node.type === "join");
  const byNode = id =>
    assets.get(definition.nodes.find(node => node.id === id).config.assetId);
  if (!aggregates.length) {
    assert(join && definition.nodes.length === 6, "Unknown join-only model");
    const left = byNode(join.config.leftInputNodeId),
      right = byNode(join.config.rightInputNodeId);
    const [[count]] = await db.query(
      "SELECT COUNT(*) AS matches FROM JSON_TABLE(?, '$[*]' COLUMNS(uid INT PATH '$.uid' NULL ON EMPTY)) l JOIN JSON_TABLE(?, '$[*]' COLUMNS(uid INT PATH '$.uid' NULL ON EMPTY)) r ON l.uid=r.uid",
      [left.sampleJson, right.sampleJson]
    );
    assert.equal(
      Number(count.matches),
      0,
      "Join-only fixture changed; review the expected business result"
    );
    return { rows: [], missingBusinessKey: true };
  }
  assert.equal(aggregates.length, 1);
  const metric = aggregates[0].config.metrics;
  assert.deepEqual(aggregates[0].config.groupBy, ["dept"]);
  assert.deepEqual(metric, [
    { field: "amount", name: "totalAmount", operation: "sum" },
  ]);
  const orderNode = definition.nodes.find(
    node =>
      node.type === "source" &&
      assets
        .get(node.config.assetId)
        .schema.some(field => field.name === "orderId")
  );
  assert(orderNode);
  const orders = assets.get(orderNode.config.assetId);
  const users = join ? byNode(join.config.rightInputNodeId) : null;
  if (join) {
    assert.equal(
      join.config.leftInputNodeId,
      orderNode.id,
      "Review the legacy left/right binding"
    );
    const ids = users.sample.map(row => row.uid);
    assert.equal(
      new Set(ids).size,
      ids.length,
      "Oracle requires unique user keys"
    );
  }
  const rows = await readRows(
    `WITH orders AS (
    SELECT o.*,ROW_NUMBER() OVER (PARTITION BY orderId ORDER BY ordinal) AS duplicateNo
    FROM JSON_TABLE(?, '$[*]' COLUMNS(ordinal FOR ORDINALITY, orderId VARCHAR(100) PATH '$.orderId', uid INT PATH '$.uid' NULL ON EMPTY, dept VARCHAR(100) PATH '$.dept', amount DECIMAL(20,4) PATH '$.amount', status VARCHAR(100) PATH '$.status')) o
  ) SELECT dept,SUM(amount) AS totalAmount,MIN(ordinal) AS firstOrdinal FROM orders
  WHERE duplicateNo=1 ${users ? "AND status='paid' AND uid IN (SELECT uid FROM JSON_TABLE(?, '$[*]' COLUMNS(uid INT PATH '$.uid')) u)" : ""}
  GROUP BY dept ORDER BY totalAmount DESC,firstOrdinal ASC`,
    users ? [orders.sampleJson, users.sampleJson] : [orders.sampleJson]
  );
  return {
    rows: rows.map(row => ({
      dept: row.dept,
      totalAmount: Number(row.totalAmount),
    })),
    missingBusinessKey: false,
  };
}

async function collectPlans() {
  const originals = await publishedSources(),
    fingerprint = digest(originals),
    plans = [];
  for (const row of originals) {
    const definition = parse(row.publishedExecutionPlanJson)?.definition;
    if (!definition) continue;
    const conversion = inspectDataflowConfigConversion(definition);
    if (
      !conversion.candidate ||
      !analyzeWorkflowDefinition(conversion.candidate, { flowType: "data" }).ok
    )
      continue;
    assert.equal(
      (await dataflowResourceDiagnostics(db, row.projectId, definition)).length,
      0
    );
    assert.deepEqual(
      definition.settings,
      {},
      "Do not copy schedules or external configuration"
    );
    assert(
      definition.nodes.every(node =>
        [
          "start",
          "end",
          "source",
          "join",
          "filter",
          "project",
          "derive",
          "deduplicate",
          "aggregate",
          "sort",
          "quality_gate",
          "sink",
        ].includes(node.type)
      )
    );
    assert(
      definition.nodes
        .filter(node => node.type === "sink")
        .every(node => node.config.writeMode === "audit_only")
    );
    const assetIds = definition.nodes
      .filter(node => node.type === "source")
      .map(node => node.config.assetId);
    const assets = await readRows(
      "SELECT a.*,s.sourceType,s.status AS sourceStatus FROM data_asset a LEFT JOIN data_source s ON s.id=a.sourceId AND s.projectId=a.projectId WHERE a.projectId=? AND a.id IN (?) ORDER BY a.id",
      [row.projectId, assetIds]
    );
    assert.equal(assets.length, new Set(assetIds).size);
    const byId = new Map(
      assets.map(asset => {
        assert.equal(asset.sourceType, "inline");
        const sample = parse(asset.sampleJson),
          schema = parse(asset.schemaJson);
        assert(
          Array.isArray(sample) &&
            sample.length <= 4 &&
            Array.isArray(schema) &&
            schema.length <= 10
        );
        return [
          asset.id,
          { ...asset, sample, schema, sampleJson: JSON.stringify(sample) },
        ];
      })
    );
    plans.push({
      originalId: row.id,
      candidate: conversion.candidate,
      assets: byId,
      expected: await expectedOutput(conversion.candidate, byId),
    });
  }
  assert.equal(
    plans.length,
    13,
    "Inventory changed; review the isolated scope before writing"
  );
  assert.equal(
    new Set(plans.flatMap(plan => [...plan.assets.keys()])).size,
    20
  );
  return { fingerprint, plans };
}

async function cleanup() {
  const [actual] = await readRows(
    "SELECT id,name,code,ownerUserId,status,lifecycleVersion FROM flow_project WHERE code=?",
    [tag]
  );
  if (!actual) return;
  assert.equal(Number(actual.ownerUserId), actor.id);
  assert.equal(actual.name, `配置执行隔离_${tag}`);
  project = actual;
  const workflows = await readRows(
    "SELECT id,name,ownerUserId FROM workflow WHERE projectId=? ORDER BY id",
    [project.id]
  );
  assert(workflows.length <= 13);
  for (const flow of workflows) {
    assert.equal(Number(flow.ownerUserId), actor.id);
    assert(flow.name.endsWith(tag));
    ownedWorkflows.add(flow.id);
  }
  const runs = await api("data.runs", { projectId: project.id, limit: 100 });
  assert(runs.length <= 13);
  for (const run of runs) {
    assert(ownedWorkflows.has(run.workflowId));
    if (!["success", "failed"].includes(run.status)) await waitForRun(run.id);
  }
  for (const flow of workflows) {
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
  const assets = await readRows(
    "SELECT id,status FROM data_asset WHERE projectId=?",
    [project.id]
  );
  assert(assets.length <= 20);
  for (const asset of assets)
    if (asset.status !== "disabled")
      await api(
        "data.updateAsset",
        { projectId: project.id, assetId: asset.id, status: "disabled" },
        true
      );
  const sources = await readRows(
    "SELECT id,status,sourceType FROM data_source WHERE projectId=?",
    [project.id]
  );
  assert(sources.length <= 1);
  for (const source of sources) {
    assert.equal(source.sourceType, "inline");
    if (source.status !== "disabled")
      await api(
        "data.updateSource",
        { projectId: project.id, sourceId: source.id, status: "disabled" },
        true
      );
  }
  const [version] = await readRows(
    "SELECT status,lifecycleVersion FROM flow_project WHERE id=?",
    [project.id]
  );
  if (version.status !== "archived")
    await api(
      "project.changeStatus",
      {
        projectId: project.id,
        status: "archived",
        expectedVersion: Number(version.lifecycleVersion),
        expectedWorkflowCount: 0,
      },
      true
    );
  const [remaining] = await readRows(
    "SELECT (SELECT COUNT(*) FROM workflow WHERE projectId=? AND archivedAt IS NULL) AS activeFlows,(SELECT COUNT(*) FROM data_asset WHERE projectId=? AND status<>'disabled') AS activeAssets,(SELECT COUNT(*) FROM data_source WHERE projectId=? AND status<>'disabled') AS activeSources,(SELECT status FROM flow_project WHERE id=?) AS projectStatus",
    [project.id, project.id, project.id, project.id]
  );
  assert.deepEqual(
    { ...remaining },
    {
      activeFlows: 0,
      activeAssets: 0,
      activeSources: 0,
      projectStatus: "archived",
    }
  );
  report({
    stage: "cleanup",
    tag,
    projectId: project.id,
    workflows: workflows.length,
    runs: runs.length,
    assets: assets.length,
    cleanupComplete: true,
  });
}

try {
  const inventory = process.env.FLOW_CONVERTED_RUNTIME_CLEANUP_TAG
    ? null
    : await collectPlans();
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
  if (inventory) {
    report({
      stage: "scope",
      tag,
      models: inventory.plans.length,
      assets: 20,
      sourceFingerprint: inventory.fingerprint,
      observe,
    });
    project = await api(
      "project.create",
      { code: tag, name: `配置执行隔离_${tag}` },
      true
    );
    report({ stage: "project-created", tag, projectId: project.id });
    const source = await api(
      "data.createSource",
      {
        projectId: project.id,
        name: `内联隔离源_${tag}`,
        sourceType: "inline",
        connection: {},
      },
      true
    );
    const mapped = new Map(),
      results = [];
    for (const [index, plan] of inventory.plans.entries()) {
      for (const [id, asset] of plan.assets)
        if (!mapped.has(id)) {
          const copy = await api(
            "data.createAsset",
            {
              projectId: project.id,
              sourceId: source.id,
              name: `样本_${mapped.size + 1}_${tag}`,
              assetType: "dataset",
              schema: asset.schema,
              sample: asset.sample,
            },
            true
          );
          mapped.set(id, copy.id);
        }
      const definition = structuredClone(plan.candidate);
      for (const node of definition.nodes) {
        if (node.type === "source")
          node.config.assetId = mapped.get(node.config.assetId);
        if (node.type === "sink")
          node.config.idempotencyKey = `${tag}_${index}`;
      }
      const workflow = await api(
        "project.createWorkflow",
        {
          projectId: project.id,
          name: `配置执行_${index + 1}_${tag}`,
          flowType: "data",
          definition,
        },
        true
      );
      ownedWorkflows.add(workflow.id);
      const draft = await api("workflow.get", { id: workflow.id });
      await api(
        "project.auditWorkflow",
        {
          projectId: project.id,
          workflowId: workflow.id,
          auditStatus: "approved",
          expectedDefinitionVersion: Number(draft.definitionVersion),
          expectedAuditStatus: draft.auditStatus,
        },
        true
      );
      await api(
        "workflow.publish",
        {
          id: workflow.id,
          expectedDefinitionVersion: Number(draft.definitionVersion),
        },
        true
      );
      const published = await api("workflow.get", { id: workflow.id });
      const started = await api(
        "data.run",
        {
          projectId: project.id,
          workflowId: workflow.id,
          expectedDefinitionVersion: Number(published.definitionVersion),
        },
        true
      );
      const run = await waitForRun(started.runId ?? started.id);
      const actual = run.output?.terminals?.[0]?.rows;
      const matches = digest(actual) === digest(plan.expected.rows);
      const result = {
        originalId: plan.originalId,
        workflowId: workflow.id,
        runId: run.id,
        status: run.status,
        matchesExpected: matches,
        expected: plan.expected,
        actual,
        version: run.definitionVersion,
        source: run.executionSource,
      };
      results.push(result);
      report({ stage: "case", tag, ...result });
      assert.equal(run.status, "success", "Isolated execution failed");
      assert.equal(run.executionSource, "published_plan");
      assert.equal(run.definitionVersion, Number(published.definitionVersion));
      assert.equal(run.nodeRuns.length, definition.nodes.length);
      assert(run.nodeRuns.every(node => node.status === "success"));
      assert.equal(run.output.terminals.length, 1);
      if (!observe)
        assert(
          matches,
          "Output values or ordering differ from the independent SQL oracle"
        );
    }
    report({
      stage: "execution-summary",
      tag,
      cases: results.length,
      correct: results.filter(result => result.matchesExpected).length,
      missingBusinessKeyCases: results.filter(
        result => result.expected.missingBusinessKey
      ).length,
    });
    // Exclude only this newly created tagged project from the original published-data fingerprint.
    const originalRows = (await publishedSources()).filter(
      row => row.projectId !== project.id
    );
    assert.equal(
      digest(originalRows),
      inventory.fingerprint,
      "Original definitions changed"
    );
  }
} finally {
  try {
    if (actor) await cleanup();
  } finally {
    await db.end();
  }
}
