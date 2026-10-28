// Read-only acceptance: bundle with esbuild (packages external) before running
// inside the deployed app. Two normal admin logins append login_success only.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import superjson from "superjson";
import { normalizeRoleAuditEvent, authorizationAuditActions } from "../shared/role-audit-event.ts";
import { auditActionSql } from "../server/authorization-audit-pagination.ts";

const base = "http://124.223.198.84:1180";
const db = await mysql.createConnection(process.env.DATABASE_URL);
let cookie = "";
const timings = [];
async function api(method, input, { mutation = false, status = 200, anonymous = false } = {}) {
  const body = JSON.stringify(superjson.serialize(input));
  const start = performance.now();
  const response = await fetch(`${base}/api/trpc/${method}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`, {
    method: mutation ? "POST" : "GET", headers: { "content-type": "application/json", cookie: anonymous ? "" : cookie },
    ...(mutation ? { body } : {}), signal: AbortSignal.timeout(20000),
  });
  timings.push(Math.round(performance.now() - start));
  assert.equal(response.status, status, `Unexpected status for ${method}`);
  if (status !== 200) return;
  const next = response.headers.getSetCookie()[0];
  if (next) cookie = next.split(";", 1)[0];
  const value = await response.json();
  assert(!value.error, `Request failed: ${method}`);
  return superjson.deserialize(value.result.data);
}
async function login() {
  assert(process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME && process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD, "Admin environment is required");
  await api("auth.login", { username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME, password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD }, { mutation: true });
}
async function history() {
  const [rows] = await db.query(`SELECT a.*,actor.username AS actorUsername,actor.name AS actorName,
    target.username AS targetUsername,target.name AS targetName,UNIX_TIMESTAMP(a.createdAt)*1000 AS epoch
    FROM authorization_audit_log a LEFT JOIN users actor ON actor.id=a.actorUserId
    LEFT JOIN users target ON target.id=a.targetUserId ORDER BY a.createdAt DESC,a.id DESC`);
  return rows;
}
function matching(rows, input, cutoff) {
  return rows.filter(raw => {
    const item = normalizeRoleAuditEvent(raw);
    const action = authorizationAuditActions[item.action];
    if (Number(item.epoch) >= cutoff) return false;
    if (input.category && input.category !== "all" && input.category !== (action?.category ?? "other")) return false;
    if (input.from !== undefined && Number(item.epoch) < input.from) return false;
    if (input.until !== undefined && Number(item.epoch) >= input.until) return false;
    const text = [item.id, raw.action, item.action, action?.label ?? "未识别操作", item.actorUsername, item.actorName,
      item.targetUsername, item.targetName, item.resourceType, item.resourceId, item.requestId].filter(value => value != null).join(" ").toLowerCase();
    return !input.search || text.includes(input.search.trim().toLowerCase());
  });
}
function check(page, expected, offset = 0, limit = 10) {
  const actualOffset = Math.min(offset, Math.max(0, Math.ceil(expected.length / limit) - 1) * limit);
  assert.equal(page.total, expected.length);
  assert.equal(page.offset, actualOffset);
  assert.deepEqual(page.items.map(item => item.id), expected.slice(actualOffset, actualOffset + limit).map(item => item.id));
}
try {
  await api("iam.authorizationAuditPage", {}, { anonymous: true, status: 401 });
  await login();
  const first = await api("iam.authorizationAuditPage", {});
  const rows = await history();
  const expected = matching(rows, {}, first.snapshotBefore);
  assert(expected.length > 30, "Acceptance needs existing history beyond 20 records");
  check(first, expected);
  const ids = first.items.map(item => item.id);
  for (const offset of [10, 20]) {
    const page = await api("iam.authorizationAuditPage", { offset, snapshotBefore: first.snapshotBefore });
    check(page, expected, offset); ids.push(...page.items.map(item => item.id));
  }
  assert.equal(new Set(ids).size, ids.length);
  const older = expected[35];
  assert(older && !first.items.some(item => item.id === older.id));
  const epoch = Number(older.epoch);
  const scenarios = [
    { search: older.id }, { search: older.actorUsername ?? older.targetUsername ?? older.id },
    { category: "roles" }, { category: "projects" }, { search: "授予角色" },
    { from: epoch, until: epoch + 1000 }, { until: epoch },
    { from: Date.UTC(2099, 0, 1) }, { until: Date.UTC(9999, 0, 1) },
    { category: "other" }, { search: "%_=' OR 1=1 --" }, { offset: 999999 },
  ];
  for (const input of scenarios) {
    const page = await api("iam.authorizationAuditPage", { ...input, snapshotBefore: first.snapshotBefore });
    check(page, matching(rows, input, first.snapshotBefore), input.offset);
  }
  assert(matching(rows, { category: "roles" }, first.snapshotBefore).length > 0);
  assert(matching(rows, { category: "projects" }, first.snapshotBefore).length > 0);
  assert(matching(rows, { search: "授予角色" }, first.snapshotBefore).length > 0);
  for (const input of [{ limit: 0 }, { limit: 201 }, { category: "invalid" }, { from: epoch + 1000, until: epoch }]) {
    await api("iam.authorizationAuditPage", input, { status: 400 });
  }
  let jsonCases = 0;
  for (const resourceType of ["iam_role", "flow_project", "user"]) {
    for (const detailsJson of [{ operation: "custom_role_created" }, { operation: "project_archived" }, JSON.stringify({ operation: "custom_role_updated" }), "bad", null, []]) {
      const event = { action: "user_updated", resourceType, detailsJson };
      const [[actual]] = await db.query(`SELECT ${auditActionSql} AS action FROM (SELECT ? AS action,? AS resourceType,CAST(? AS JSON) AS detailsJson) a`, [event.action, resourceType, JSON.stringify(detailsJson)]);
      assert.equal(actual.action, normalizeRoleAuditEvent(event).action); jsonCases++;
    }
  }
  // A normal re-login adds a newer audit event while this historical page stays fixed.
  await login();
  check(await api("iam.authorizationAuditPage", { offset: 10, snapshotBefore: first.snapshotBefore }), expected, 10);
  const [[inserted]] = await db.query("SELECT UNIX_TIMESTAMP(MAX(createdAt))*1000 AS time FROM authorization_audit_log");
  for (let attempt = 0; attempt < 8; attempt++) {
    const [[clock]] = await db.query("SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP())*1000 AS time");
    if (Number(clock.time) > Number(inserted.time)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const refreshed = await api("iam.authorizationAuditPage", {});
  check(refreshed, matching(await history(), {}, refreshed.snapshotBefore));
  assert(refreshed.total > first.total, "Refresh must include newly committed login history");
  assert(Array.isArray(await api("iam.authorizationAudit", { limit: 10 })));
  console.log(JSON.stringify({ fullHistoryTotal: first.total, defaultPageSize: first.limit, disjointPages: 3,
    filterScenarios: scenarios.length, rejectedInputs: 4, anonymousDenied: true, sqlJsonCases: jsonCases,
    snapshotStableAcrossLogin: true, refreshAddedRecords: refreshed.total - first.total,
    maxRequestMs: Math.max(...timings), businessWrites: 0, loginAuditAppends: 2 }));
} finally { await db.end(); }
