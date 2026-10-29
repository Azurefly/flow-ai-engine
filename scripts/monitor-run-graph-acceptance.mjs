// Read-only acceptance: bundle this script, then set FLOW_MONITOR_GRAPH_RUN_IDS
// to existing terminal workflow runs. Never creates fixtures or controls runs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";
import { projectRunGraph, resolveRunGraphRecord } from "../shared/run-execution-graph.ts";
import { approvalGroupsForRecord } from "../shared/run-approval-progress.ts";

const base = "http://124.223.198.84:1180/";
const ids = [...new Set((process.env.FLOW_MONITOR_GRAPH_RUN_IDS || "").split(",").filter(Boolean))];
assert(ids.length > 0 && ids.length <= 8, "Provide one to eight existing run IDs");
assert(ids.every(id => /^[A-Za-z0-9_-]{8,64}$/.test(id)), "Invalid run ID");
const db = await mysql.createConnection(process.env.DATABASE_URL);
let cookie = "";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parse = value => typeof value === "string" ? JSON.parse(value) : value;

async function api(path, input) {
  assert(["auth.login", "workflow.runDetail"].includes(path), "Unsupported acceptance operation");
  const login = path === "auth.login";
  const body = JSON.stringify(superjson.serialize(input));
  const response = await fetch(base + "api/trpc/" + path + (login ? "" : "?input=" + encodeURIComponent(body)), {
    method: login ? "POST" : "GET",
    headers: { "content-type": "application/json", cookie },
    ...(login ? { body } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const next = response.headers.getSetCookie()[0];
  if (next) cookie = next.split(";", 1)[0];
  const payload = await response.json();
  assert(response.ok && !payload.error, `Acceptance request failed: ${response.status}`);
  return superjson.deserialize(payload.result.data);
}

async function facts(id) {
  const result = [];
  for (const [i, table] of ["workflow_run", "workflow_node_run", "workflow_task", "workflow_task_group", "workflow_run_job", "workflow_state_transition", "workflow_milestone", "workflow_participant_state"].entries()) {
    const [rows] = await db.query(`SELECT * FROM ${table} WHERE ${i === 0 ? "id" : "runId"}=? ORDER BY id`, [id]);
    result.push(rows);
  }
  return result;
}

try {
  const anonymous = await fetch(base + "api/trpc/workflow.runDetail?input=" + encodeURIComponent(JSON.stringify(superjson.serialize({ runId: ids[0] }))), { signal: AbortSignal.timeout(20000) });
  assert(anonymous.status === 401, "Anonymous run detail must be rejected");
  await api("auth.login", {
    username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  });
  const evidence = [];
  for (const runId of ids) {
    const before = await facts(runId);
    const [stored] = before[0];
    assert(stored && ["success", "failed", "cancelled", "terminated"].includes(stored.status), "Use existing terminal runs only");
    const detail = await api("workflow.runDetail", { runId });
    assert(detail.id === runId && detail.workflowId === stored.workflowId && detail.status === stored.status, "Run identity/status mismatch");
    assert(digest(parse(detail.definitionSnapshotJson)) === digest(parse(stored.definitionSnapshotJson)), "Run snapshot mismatch");
    assert(digest(parse(detail.errorJson)) === digest(parse(stored.errorJson)), "Instance error mismatch");
    assert(detail.nodeRuns.length === before[1].length, "Execution count mismatch");
    const records = new Map(detail.nodeRuns.map(record => [record.id, record]));
    assert(records.size === before[1].length, "Duplicate execution identity");
    for (const storedRecord of before[1]) {
      const record = records.get(storedRecord.id);
      assert(record && ["nodeId", "nodeType", "status", "durationMs"].every(key => record[key] === storedRecord[key]), "Execution identity/status mismatch");
      for (const key of ["inputJson", "outputJson", "errorJson"])
        assert(digest(parse(record[key])) === digest(parse(storedRecord[key])), "Execution payload mismatch");
    }
    const graph = projectRunGraph(detail);
    const storedGraph = projectRunGraph({ ...stored, nodeRuns: before[1] });
    assert(digest(graph) === digest(storedGraph), "Canvas projection differs from stored history");
    const groupRecords = new Map();
    let focusedRecords = 0;
    for (const node of graph.nodes) for (const record of node.records) {
      assert(resolveRunGraphRecord(node, {}, record.id)?.id === record.id, "Exact execution focus lost");
      focusedRecords++;
      for (const group of approvalGroupsForRecord(detail.approvalGroups ?? [], record)) {
        assert(!groupRecords.has(group.groupId), "Approval group crossed execution batches");
        groupRecords.set(group.groupId, record.id);
        const storedGroup = before[3].find(item => item.id === group.groupId);
        const tasks = before[2].filter(task => task.approvalGroupId === group.groupId);
        assert(storedGroup && group.nodeId === storedGroup.nodeId && group.total === storedGroup.totalApprovers && group.required === storedGroup.requiredApprovals, "Approval threshold mismatch");
        assert(group.participants.length === tasks.length, "Approval participant count mismatch");
        assert(group.approved === tasks.filter(task => task.status === "completed" && parse(task.resultJson)?.decision === "approved").length, "Approval progress mismatch");
      }
    }
    assert(focusedRecords === before[1].length, "Canvas omitted execution records");
    assert(digest(before) === digest(await facts(runId)), "Read-only acceptance changed history");
    evidence.push({ runId, status: detail.status, nodes: graph.nodes.length, edges: graph.edges.length, focusedRecords, repeatedNodes: graph.nodes.filter(node => node.records.length > 1).length, matchedApprovalGroups: groupRecords.size });
  }
  console.log(JSON.stringify({ readOnly: true, anonymousRejected: true, runs: evidence }));
} finally {
  await db.end();
}
