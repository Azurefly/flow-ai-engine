import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";
// Read-only acceptance against an existing repeated-node approval run, never creates fixtures.
const base = "http://124.223.198.84:1180/";
const runId =
  process.env.FLOW_APPROVAL_BATCH_RUN_ID ||
  "f919b926-c37c-4892-9f2d-2102539d8dce";
assert.match(runId, /^[A-Za-z0-9_-]{8,64}$/);
const db = await mysql.createConnection(process.env.DATABASE_URL);
let cookie = "";
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
  assert(
    response.ok && !value.error,
    `${path}: ${value.error?.json?.message ?? response.status}`
  );
  return superjson.deserialize(value.result.data);
}
const digest = value =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function recordedSnapshot() {
  const [workflow] = await db.query(
    "SELECT w.id,w.definitionVersion,w.definitionJson FROM workflow w JOIN workflow_run r ON r.workflowId=w.id WHERE r.id=?",
    [runId]
  );
  const [run] = await db.query(
    "SELECT id,status,definitionSnapshotJson,contextJson,finalOutputJson FROM workflow_run WHERE id=?",
    [runId]
  );
  const [nodes] = await db.query(
    "SELECT id,nodeId,status,inputJson,outputJson,errorJson FROM workflow_node_run WHERE runId=? ORDER BY id",
    [runId]
  );
  const [tasks] = await db.query(
    "SELECT id,status,resultJson,payloadJson,approvalGroupId FROM workflow_task WHERE runId=? ORDER BY id",
    [runId]
  );
  const [jobs] = await db.query(
    "SELECT id,status FROM workflow_run_job WHERE runId=? ORDER BY id",
    [runId]
  );
  return digest({ workflow, run, nodes, tasks, jobs });
}
try {
  await api(
    "auth.login",
    {
      username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
    },
    true
  );
  const before = await recordedSnapshot();
  const run = await api("workflow.runDetail", { runId });
  const [rows] = await db.query(
    `SELECT g.id,g.nodeId,g.signMode,g.totalApprovers,g.requiredApprovals,
    SUM(t.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(t.resultJson,'$.decision'))='approved') AS approved,
    SUM(t.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(t.resultJson,'$.decision'))='rejected') AS rejected,COUNT(*) AS members
    FROM workflow_task_group g JOIN workflow_task t ON t.approvalGroupId=g.id WHERE g.runId=? GROUP BY g.id ORDER BY g.id`,
    [runId]
  );
  assert(
    rows.length >= 2,
    "Existing fixture must contain at least two groups on a repeated node"
  );
  assert.equal(run.approvalGroups.length, rows.length);
  const pairs = [];
  for (const row of rows) {
    const group = run.approvalGroups.find(item => item.groupId === row.id);
    assert(group);
    assert.equal(group.nodeId, row.nodeId);
    assert.equal(group.signMode, row.signMode);
    for (const [key, column] of [
      ["approved", "approved"],
      ["rejected", "rejected"],
      ["total", "totalApprovers"],
      ["required", "requiredApprovals"],
    ])
      assert.equal(group[key], Number(row[column]));
    assert.equal(group.participants.length, Number(row.members));
    assert(group.nodeRunId && !group.batchConflict);
    const record = run.nodeRuns.find(item => item.id === group.nodeRunId);
    assert(record);
    assert.equal(record.nodeId, group.nodeId);
    const output =
      typeof record.outputJson === "string"
        ? JSON.parse(record.outputJson)
        : record.outputJson;
    assert.equal(output.approvalGroupId, group.groupId);
    assert.equal(output.approvalProgress.approved, group.approved);
    pairs.push({
      groupId: group.groupId,
      nodeRunId: group.nodeRunId,
      approved: group.approved,
      required: group.required,
      participants: group.participants.length,
    });
  }
  assert.equal(new Set(pairs.map(item => item.nodeRunId)).size, rows.length);
  assert.equal(
    await recordedSnapshot(),
    before,
    "Read-only progress inspection changed workflow/run/task/job data"
  );
  console.log(
    JSON.stringify({
      accepted: true,
      runId,
      groupsChecked: rows.length,
      separateBatchRecords: true,
      recordedDataUnchanged: true,
      executionRequests: 0,
      fixturesCreated: 0,
      groups: pairs,
    })
  );
} finally {
  await db.end();
}
