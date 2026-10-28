// Read-only acceptance against existing runs; never creates fixtures or executes flows.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";

const base = "http://124.223.198.84:1180/";
const ids = (process.env.FLOW_DATA_GRAPH_RUN_IDS || "")
  .split(",")
  .filter(Boolean);
assert(
  ids.length > 0 && ids.length <= 3,
  "Provide one to three existing run IDs"
);
assert(ids.every(id => /^[A-Za-z0-9_-]{8,64}$/.test(id)));
const db = await mysql.createConnection(process.env.DATABASE_URL);
let cookie = "";
async function api(path, input, mutation = false) {
  const body = JSON.stringify(superjson.serialize(input));
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
  const payload = await response.json();
  assert(response.ok && !payload.error, `${path}: ${response.status}`);
  return superjson.deserialize(payload.result.data);
}
function parse(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}
async function facts(id) {
  const result = [];
  for (const [table, field] of [
    ["dataflow_run", "id"],
    ["dataflow_node_run", "runId"],
    ["dataflow_run_job", "runId"],
    ["dataflow_dataset_artifact", "runId"],
    ["dataflow_lineage_edge", "runId"],
  ]) {
    const [rows] = await db.query(
      `SELECT * FROM ${table} WHERE ${field}=? ORDER BY id`,
      [id]
    );
    result.push(rows);
  }
  return {
    rows: result,
    hash: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
  };
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
  const evidence = [];
  for (const id of ids) {
    const before = await facts(id);
    const row = before.rows[0][0];
    assert(
      row && ["success", "failed", "cancelled"].includes(row.status),
      "Use an existing terminal run"
    );
    const detail = await api("data.runDetail", {
      projectId: row.projectId,
      runId: id,
    });
    const stored = parse(row.definitionSnapshotJson);
    const definition = stored?.definition ?? stored;
    assert.equal(detail.status, row.status);
    assert.equal(detail.workflowId, row.workflowId);
    assert.deepEqual(detail.output, parse(row.outputJson));
    assert.deepEqual(detail.error, parse(row.errorJson));
    const snapshot = detail.definitionSnapshot;
    assert.deepEqual(
      snapshot.nodes.map(n => [n.id, n.name, n.type]),
      definition.nodes.map(n => [n.id, n.name, n.type])
    );
    assert.deepEqual(
      snapshot.edges.map(e => [e.id, e.sourceNodeId, e.targetNodeId]),
      definition.edges.map(e => [
        e.id,
        e.sourceNodeId ?? e.source,
        e.targetNodeId ?? e.target,
      ])
    );
    for (const node of snapshot.nodes) {
      assert(
        Object.keys(node).every(key =>
          ["id", "name", "type", "position"].includes(key)
        )
      );
      assert(!Object.hasOwn(node, "config"));
    }
    for (const edge of snapshot.edges)
      assert(
        Object.keys(edge).every(key =>
          ["id", "sourceNodeId", "targetNodeId"].includes(key)
        )
      );
    assert.equal(detail.nodeRuns.length, before.rows[1].length);
    for (const node of detail.nodeRuns) {
      const fact = before.rows[1].find(n => n.id === node.id);
      assert(fact);
      assert.equal(node.nodeId, fact.nodeId);
      assert.equal(node.status, fact.status);
      assert.equal(node.attempt, Number(fact.attempt));
      assert.equal(node.rowCount, fact.rowCount);
      assert.deepEqual(node.output, parse(fact.outputJson));
      assert.deepEqual(node.error, parse(fact.errorJson));
      assert.equal(
        new Date(node.startedAt).getTime(),
        new Date(fact.startedAt).getTime()
      );
    }
    const other = (
      await db.query("SELECT id FROM flow_project WHERE id<>? LIMIT 1", [
        row.projectId,
      ])
    )[0][0];
    assert(other);
    assert.equal(
      await api("data.runDetail", { projectId: other.id, runId: id }),
      null
    );
    const after = await facts(id);
    assert.equal(after.hash, before.hash);
    evidence.push({
      runId: id,
      status: detail.status,
      snapshotNodes: snapshot.nodes.length,
      snapshotEdges: snapshot.edges.length,
      nodeRecords: detail.nodeRuns.length,
      snapshotConfigurationExcluded: true,
      otherProjectRejected: true,
      recordedDataUnchanged: true,
    });
  }
  console.log(
    JSON.stringify({
      accepted: true,
      fixturesCreated: 0,
      executionRequests: 0,
      evidence,
    })
  );
} finally {
  await db.end();
}
