// Public-service regression only; no database writes, token printing, or production task changes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const json = JSON.stringify({ json: input ?? null });
    const response = await fetch(
      `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(json)}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie: this.cookie },
        ...(mutation ? { body: json } : {}),
      }
    );
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error)
      throw new Error(
        `${path}: ${payload.error?.json?.message ?? response.status}`
      );
    return payload.result.data.json;
  }
}
async function waitFor(read, accept, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out: ${label}`);
}
const admin = new Session();
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(username && password, "Missing existing login configuration");
await admin.request("auth.login", { username, password }, true);
const projectId = process.argv[2];
assert(projectId, "Provide isolated DEDUP test project ID");
const project = (await admin.request("project.list", null)).find(
  p => p.id === projectId
);
assert(
  project && String(project.code).startsWith("DEDUP_"),
  "Only independent dataflow test projects are accepted"
);
const full = await admin.request("data.runs", { projectId, limit: 30 });
const summary = await admin.request("data.runs", {
  projectId,
  limit: 30,
  summaryOnly: true,
});
assert(full.length > 0);
assert.deepEqual(
  summary.map(r => [r.id, r.status, r.workflowName]),
  full.map(r => [r.id, r.status, r.workflowName])
);
for (const row of summary) {
  for (const key of [
    "input",
    "output",
    "error",
    "checkpoint",
    "inputJson",
    "outputJson",
    "errorJson",
    "checkpointJson",
    "executionPlanJson",
  ])
    assert(!Object.hasOwn(row, key), `Summary leaked payload: ${key}`);
  const detail = await admin.request("data.runDetail", {
    projectId,
    runId: row.id,
  });
  assert.equal(detail.status, row.status);
  assert.deepEqual(detail.output, full.find(r => r.id === row.id).output);
}
const fullBytes = Buffer.byteLength(JSON.stringify(full));
const summaryBytes = Buffer.byteLength(JSON.stringify(summary));
assert(summaryBytes < fullBytes);
console.log(
  JSON.stringify({
    projectId,
    count: summary.length,
    fullBytes,
    summaryBytes,
    reductionPercent: Math.round((1 - summaryBytes / fullBytes) * 100),
    detailsPreserved: true,
  })
);
