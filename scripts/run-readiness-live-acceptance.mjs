import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";

// Opt-in acceptance on the designated deployment only. No accounts or grants.
// At most one business, three flows, one inline source/asset and six runs.
assert.equal(process.env.FLOW_READINESS_LIVE_ACCEPTANCE, "1");
const base = "http://124.223.198.84:1180/";
const tag = randomBytes(6).toString("hex");
const code = `RREADY_${tag}`.toUpperCase();
const prefix = `运行门禁_${tag}_`;
const db = await mysql.createConnection(process.env.DATABASE_URL);
let cookie = "",
  actorId,
  projectId,
  initialSettings;
const flows = [],
  runIds = [],
  results = [];
let baseline = false,
  executions = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, input, mutation = false) {
  const body = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(
    base +
      "api/trpc/" +
      path +
      (mutation ? "" : "?input=" + encodeURIComponent(body)),
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body } : {}),
      signal: AbortSignal.timeout(20000),
    }
  );
  const next = response.headers.getSetCookie()[0];
  if (next) cookie = next.split(";", 1)[0];
  const value = await response.json();
  if (!response.ok || value.error)
    throw Object.assign(
      new Error(`${path}: ${value.error?.json?.message ?? response.status}`),
      { status: response.status }
    );
  return superjson.deserialize(value.result.data);
}
async function counts() {
  const [rows] = await db.query(
    `SELECT 'runs' AS kind,COUNT(*) AS total FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?
    UNION ALL SELECT 'jobs',COUNT(*) FROM workflow_run_job j JOIN workflow_run r ON r.id=j.runId JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?
    UNION ALL SELECT 'tasks',COUNT(*) FROM workflow_task t JOIN workflow w ON w.id=t.workflowId WHERE w.projectId=?
    UNION ALL SELECT 'data_runs',COUNT(*) FROM dataflow_run WHERE projectId=?
    UNION ALL SELECT 'data_jobs',COUNT(*) FROM dataflow_run_job j JOIN dataflow_run r ON r.id=j.runId WHERE r.projectId=?`,
    Array(5).fill(projectId)
  );
  return rows;
}
async function checkpoint(flow, mode) {
  const before = await counts();
  const report = await api(
    "workflow.runReadiness",
    { workflowId: flow.id, mode, input: { acceptanceTag: tag } },
    true
  );
  assert.equal(report.canStart, true, JSON.stringify(report.issues));
  assert.match(report.planHash, /^[a-f0-9]{64}$/);
  assert.equal(
    report.executionSource,
    mode === "formal" ? "published_plan" : "draft"
  );
  assert.deepEqual(
    await counts(),
    before,
    "Readiness must not create runs, tasks or jobs"
  );
  return report;
}
async function start(flow, mode, report, expectRejected = false) {
  const proof = {
    expectedDefinitionVersion: report.definitionVersion,
    expectedExecutionPlanHash: report.planHash,
  };
  const input =
    flow.flowType === "data"
      ? {
          projectId,
          workflowId: flow.id,
          mode,
          data: { acceptanceTag: tag },
          ...proof,
        }
      : {
          workflowId: flow.id,
          triggerType: mode === "test" ? "test" : "manual",
          input: { acceptanceTag: tag },
          idempotencyKey: `ready-${tag}-${executions}`,
          ...proof,
        };
  if (!expectRejected) {
    assert(executions < 6);
    executions++;
  }
  const value = await api(
    flow.flowType === "data" ? "data.run" : "workflow.run",
    input,
    true
  );
  assert(!expectRejected, "Stale checkpoint unexpectedly created a run");
  runIds.push(value.runId);
  for (let attempt = 0; attempt < 100; attempt++) {
    const detail = await api(
      flow.flowType === "data" ? "data.runDetail" : "workflow.runDetail",
      { runId: value.runId, ...(flow.flowType === "data" ? { projectId } : {}) }
    );
    assert(
      !["failed", "blocked", "terminated", "canceled"].includes(detail.status),
      JSON.stringify(detail.errorJson)
    );
    if (detail.status === "success") {
      assert.equal(Number(detail.definitionVersion), report.definitionVersion);
      const [persisted] = await db.query(
        flow.flowType === "data"
          ? "SELECT executionPlanHash,executionSource,definitionVersion FROM dataflow_run WHERE id=? AND projectId=?"
          : "SELECT r.executionPlanHash,r.executionSource,r.definitionVersion FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE r.id=? AND w.projectId=?",
        [value.runId, projectId]
      );
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].executionPlanHash, report.planHash);
      assert.equal(
        Number(persisted[0].definitionVersion),
        report.definitionVersion
      );
      assert.equal(persisted[0].executionSource, detail.executionSource);
      assert.equal(
        detail.executionSource,
        mode === "formal" ? "published_plan" : "draft"
      );
      if (flow.flowType === "data")
        assert.deepEqual(detail.output.terminals[0].rows, [
          { value: 7 },
          { value: 11 },
        ]);
      results.push({
        flowType: flow.flowType,
        mode,
        runId: value.runId,
        version: report.definitionVersion,
        executionSource: detail.executionSource,
        status: detail.status,
      });
      console.log(JSON.stringify({ completed: results.at(-1) }));
      return;
    }
    if (detail.status === "waiting" && flow.flowType !== "data") {
      const task = detail.taskActivities.find(
        item => item.nodeId === "review" && item.status !== "completed"
      );
      assert(task, "Expected one own review task");
      assert.equal(Number(task.assignedUserId), actorId);
      await api("task.claim", { taskId: task.id }, true);
      await api(
        "task.complete",
        {
          taskId: task.id,
          result: { decision: "approved", comment: `隔离运行条件验收_${tag}` },
        },
        true
      );
    }
    await pause(250);
  }
  throw new Error("Isolated run did not settle within its deadline");
}
async function rejectStale(flow, report) {
  const before = await counts();
  await assert.rejects(
    start(flow, "test", report, true),
    error => error.status === 409 && error.message.includes("运行版本已变化")
  );
  assert.deepEqual(
    await counts(),
    before,
    "Rejected checkpoint created a run/task/job"
  );
}
const node = (id, type, config, x) => ({
  id,
  name: id,
  type,
  config,
  position: { x, y: 0 },
});
function definition(flowType, assetId) {
  const nodes = [node("start", "start", {}, 0)];
  if (flowType === "state")
    nodes.push(
      node(
        "pending",
        "state",
        {
          nodeDh: "PENDING",
          stateCode: "PENDING",
          stateName: "待办理",
          stateType: "business",
        },
        220
      )
    );
  nodes.push(
    flowType === "data"
      ? node("source", "source", { assetId, limit: 10 }, 440)
      : node(
          "review",
          "operate",
          {
            nodeDh: "REVIEW",
            czmc: "隔离办理",
            assigneeMode: "user",
            assigneeUserId: actorId,
            assigneeFallback: "error",
            outcomeMode: "legacy_cancel",
            outcomes: [],
            formSchema: { fields: [] },
          },
          440
        )
  );
  if (flowType === "state")
    nodes.push(
      node(
        "done",
        "state",
        {
          nodeDh: "DONE",
          stateCode: "DONE",
          stateName: "完成",
          stateType: "terminal",
        },
        660
      )
    );
  nodes.push(node("end", "end", {}, 880));
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes,
    edges: nodes.slice(1).map((target, index) => ({
      id: `edge-${index}`,
      sourceNodeId: nodes[index].id,
      targetNodeId: target.id,
      ...(nodes[index].id === "review" ? { sourceHandle: "approved" } : {}),
    })),
  };
}
async function run() {
  await api(
    "auth.login",
    {
      username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
    },
    true
  );
  const actor = await api("auth.me", null);
  assert.equal(actor.role, "admin");
  actorId = Number(actor.id);
  initialSettings = await api("config.settings", null);
  assert.equal(
    initialSettings.approval.reviewerMode,
    "project_owner_or_admin",
    "Independent review needs a separate existing reviewer; never weaken settings"
  );
  const [existing] = await db.query(
    "SELECT id FROM flow_project WHERE code=?",
    [code]
  );
  assert.equal(existing.length, 0);
  baseline = true;
  projectId = (
    await api("project.create", { code, name: `运行条件隔离验收_${tag}` }, true)
  ).id;
  console.log(
    JSON.stringify({
      fixture: {
        tag,
        code,
        projectId,
        accountsCreated: 0,
        grantsCreated: 0,
        maximumRuns: 6,
      },
    })
  );
  const source = await api(
    "data.createSource",
    {
      projectId,
      name: `${prefix}内联源`,
      sourceType: "inline",
      connection: {},
    },
    true
  );
  const asset = await api(
    "data.createAsset",
    {
      projectId,
      sourceId: source.id,
      name: `${prefix}样本`,
      assetType: "dataset",
      schema: [{ name: "value", type: "number" }],
      sample: [{ value: 7 }, { value: 11 }],
    },
    true
  );
  for (const flowType of ["state", "control", "data"]) {
    const name = prefix + flowType;
    const flow = await api(
      "project.createWorkflow",
      { projectId, name, flowType, definition: definition(flowType, asset.id) },
      true
    );
    flows.push({ id: flow.id, flowType });
    console.log(JSON.stringify({ flowCreated: { id: flow.id, flowType } }));
  }
  for (const flow of flows) {
    const old = await checkpoint(flow, "test");
    const current = await api("workflow.get", { id: flow.id });
    const changed = structuredClone(current.definition);
    changed.nodes[1].name += "_新草稿";
    await api(
      "workflow.update",
      {
        id: flow.id,
        definition: changed,
        expectedDefinitionVersion: current.definitionVersion,
      },
      true
    );
    await rejectStale(flow, old);
    const fresh = await checkpoint(flow, "test");
    assert(fresh.definitionVersion > old.definitionVersion);
    assert.notEqual(fresh.planHash, old.planHash);
    await rejectStale(flow, { ...fresh, planHash: "0".repeat(64) });
    await start(flow, "test", fresh);
    const draft = await api("workflow.get", { id: flow.id });
    await api(
      "project.auditWorkflow",
      {
        projectId,
        workflowId: flow.id,
        auditStatus: "approved",
        expectedDefinitionVersion: draft.definitionVersion,
        expectedAuditStatus: draft.auditStatus,
      },
      true
    );
    await api(
      "workflow.publish",
      { id: flow.id, expectedDefinitionVersion: draft.definitionVersion },
      true
    );
    await start(flow, "formal", await checkpoint(flow, "formal"));
  }
  assert.equal(results.length, 6);
  assert.deepEqual(await api("config.settings", null), initialSettings);
  console.log(
    JSON.stringify({
      accepted: true,
      readonlyChecksHaveNoWrites: true,
      staleVersionRejections: 3,
      wrongHashRejections: 3,
      realSuccessfulRuns: results.length,
      settingsUnchanged: true,
      results,
    })
  );
}
async function cleanup() {
  if (!baseline) return;
  const [projects] = await db.query(
    "SELECT id,ownerUserId FROM flow_project WHERE code=?",
    [code]
  );
  assert(projects.length <= 1);
  if (!projects.length) return;
  const project = projects[0];
  assert.equal(Number(project.ownerUserId), actorId);
  assert(!projectId || projectId === project.id);
  projectId = project.id;
  const [ownFlows] = await db.query(
    "SELECT id,name,ownerUserId FROM workflow WHERE projectId=?",
    [projectId]
  );
  assert(ownFlows.length <= 3);
  assert(
    ownFlows.every(
      flow =>
        flow.name.startsWith(prefix) && Number(flow.ownerUserId) === actorId
    )
  );
  const [active] = await db.query(
    "SELECT r.id FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=? AND r.status IN ('queued','running','waiting','blocked','paused')",
    [projectId]
  );
  for (const item of active)
    await api(
      "workflow.terminateRun",
      { runId: item.id, reason: `运行条件隔离验收清理_${tag}` },
      true
    );
  for (let attempt = 0; attempt < 100; attempt++) {
    const [pending] = await db.query(
      "SELECT id FROM dataflow_run WHERE projectId=? AND status IN ('queued','running')",
      [projectId]
    );
    if (!pending.length) break;
    assert(
      attempt < 99,
      "Own data runs still pending; preserve fixtures for recovery"
    );
    await pause(250);
  }
  await db.beginTransaction();
  try {
    const [members] = await db.query(
      "SELECT userId FROM flow_project_member WHERE projectId=? AND revokedAt IS NULL",
      [projectId]
    );
    assert(members.every(row => Number(row.userId) === actorId));
    const [units] = await db.query(
      "SELECT unitId FROM flow_project_unit WHERE projectId=?",
      [projectId]
    );
    assert.equal(units.length, 0);
    const [flowMembers] = ownFlows.length
      ? await db.query(
          "SELECT userId FROM workflow_member WHERE workflowId IN (?) AND revokedAt IS NULL",
          [ownFlows.map(row => row.id)]
        )
      : [[]];
    assert(flowMembers.every(row => Number(row.userId) === actorId));
    await db.query(
      "UPDATE workflow SET archivedAt=COALESCE(archivedAt,NOW()),archivedByUserId=?,updatedAt=NOW() WHERE projectId=? AND ownerUserId=?",
      [actorId, projectId, actorId]
    );
    await db.query(
      "UPDATE flow_project SET status='archived',updatedAt=NOW() WHERE id=? AND code=? AND ownerUserId=?",
      [projectId, code, actorId]
    );
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  }
  if (initialSettings)
    assert.deepEqual(await api("config.settings", null), initialSettings);
  console.log(
    JSON.stringify({
      cleanupComplete: true,
      tag,
      projectId,
      archivedFlows: ownFlows.length,
      archivedBusiness: true,
      accountsCreated: 0,
      grantsCreated: 0,
      executionsAttempted: executions,
      runIds,
      settingsUnchanged: true,
    })
  );
}
let failed = false;
try {
  await run();
} catch (error) {
  failed = true;
  console.error(error.stack || error.message);
} finally {
  try {
    await cleanup();
  } catch (error) {
    failed = true;
    console.error("CLEANUP: " + (error.stack || error.message));
  }
  await db.end();
}
if (failed) process.exitCode = 1;
