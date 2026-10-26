import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";

// Only the designated deployment is used. This script never creates or executes a workflow.
const base = "http://124.223.198.84:1180/";
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
      signal: AbortSignal.timeout(30000),
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
const hash = value =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parse = value => (typeof value === "string" ? JSON.parse(value) : value);
async function counts() {
  const [rows] = await db.query(
    "SELECT 'workflow_run' AS kind,COUNT(*) AS total FROM workflow_run UNION ALL SELECT 'workflow_run_job',COUNT(*) FROM workflow_run_job UNION ALL SELECT 'workflow_task',COUNT(*) FROM workflow_task UNION ALL SELECT 'dataflow_run',COUNT(*) FROM dataflow_run UNION ALL SELECT 'dataflow_run_job',COUNT(*) FROM dataflow_run_job UNION ALL SELECT 'workflow_version',COUNT(*) FROM workflow_version"
  );
  return rows;
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
  const actor = await api("auth.me", null);
  const [rows] = await db.query(
    "SELECT w.id,w.name,w.flowType,w.definitionVersion,w.definitionJson,w.publishedExecutionPlanHash FROM workflow w LEFT JOIN flow_project p ON p.id=w.projectId WHERE w.archivedAt IS NULL AND w.status='published' AND (w.projectId IS NULL OR p.status='active') ORDER BY w.id"
  );
  const selected = new Map();
  for (const type of ["state", "control", "data"]) {
    const options = rows
      .filter(row => row.flowType === type)
      .sort(
        (a, b) =>
          parse(a.definitionJson).nodes.length -
          parse(b.definitionJson).nodes.length
      );
    const knownId = { state: "1EFc_za1Ais8EQUT", control: "V3v_fIOeTP2Rm6or" }[
      type
    ];
    const row = options.find(row => row.id === knownId) ?? options[0];
    assert(
      row,
      `No existing ${type} workflow available for read-only acceptance`
    );
    selected.set(row.id, row);
    if (type === "data") {
      selected.set(options[0].id, options[0]);
      const legacy = options.find(row =>
        parse(row.definitionJson).nodes.some(
          node =>
            node.type === "aggregate" &&
            node.config.metrics?.some(metric => metric.as || metric.op)
        )
      );
      if (legacy) selected.set(legacy.id, legacy);
    }
  }
  const before = await counts();
  const results = [];
  for (const row of selected.values()) {
    const report = await api(
      "workflow.runReadiness",
      {
        workflowId: row.id,
        mode: row.flowType === "data" ? "formal" : "test",
        input: { userId: actor.id, approverId: actor.id },
      },
      true
    );
    assert.equal(report.definitionVersion, Number(row.definitionVersion));
    assert.equal(report.canStart, report.issues.length === 0);
    if (report.canStart) assert.match(report.planHash, /^[a-f0-9]{64}$/);
    results.push({
      id: row.id,
      flowType: row.flowType,
      version: report.definitionVersion,
      executionSource: report.executionSource,
      canStart: report.canStart,
      checks: report.checks,
      issues: report.issues,
    });
  }
  const [unchanged] = await db.query(
    "SELECT id,name,flowType,definitionVersion,definitionJson,publishedExecutionPlanHash FROM workflow WHERE id IN (?) ORDER BY id",
    [[...selected.keys()]]
  );
  assert.equal(
    hash(unchanged.sort((a, b) => a.id.localeCompare(b.id))),
    hash([...selected.values()].sort((a, b) => a.id.localeCompare(b.id)))
  );
  assert.deepEqual(
    await counts(),
    before,
    "Concurrent run changes prevent a no-new-run assertion; no execution request was sent by this script"
  );
  console.log(
    JSON.stringify({
      accepted: true,
      workflowsChecked: results.length,
      countsUnchanged: true,
      definitionsUnchanged: true,
      executionRequests: 0,
      fixturesCreated: 0,
      results,
    })
  );
} finally {
  await db.end();
}
