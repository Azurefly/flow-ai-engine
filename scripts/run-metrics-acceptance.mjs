import superjson from "superjson";
// Isolated public-service regression; no direct SQL, secrets, or existing account changes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const json = JSON.stringify(superjson.serialize(input ?? null));
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
    return superjson.deserialize(payload.result.data);
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

const tag = randomBytes(4).toString("hex");
const project = await admin.request(
  "project.create",
  { code: `METRIC_${tag}`.toUpperCase(), name: `监控耗时验证_${tag}` },
  true
);
const specs = [
  ["start", "start", {}],
  ["wait", "wait", { durationSeconds: 1 }],
  ["end", "end", {}],
];
const workflow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `平均耗时样本_${tag}`,
    flowType: "control",
    definition: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: specs.map(([id, type, config], i) => ({
        id,
        type,
        name: id,
        config,
        position: { x: i * 240, y: 0 },
      })),
      edges: specs
        .slice(1)
        .map(([id], i) => ({
          id: `e${i}`,
          sourceNodeId: specs[i][0],
          targetNodeId: id,
        })),
    },
  },
  true
);
const metrics = () =>
  admin.request("workflow.runMetrics", { workflowId: workflow.id });
const empty = await metrics();
assert.equal(empty.totalRuns, 0);
assert.equal(empty.averageDurationMs, null);
assert.equal(empty.durationSamples, 0);
const started = await admin.request(
  "workflow.run",
  {
    workflowId: workflow.id,
    triggerType: "test",
    idempotencyKey: `metric-${tag}`,
  },
  true
);
let completed = false;
try {
  const run = await waitFor(
    () => admin.request("workflow.runDetail", { runId: started.runId }),
    value => ["success", "failed"].includes(value.status),
    "timed sample completion"
  );
  assert.equal(run.status, "success");
  const measured = await metrics();
  assert.equal(measured.durationSamples, 1);
  assert.equal(measured.averageDurationMs, run.durationMs);
  assert(measured.averageDurationMs > 0);
  const stopped = await admin.request("workflow.runMetrics", {
    workflowId: "KPfT9I2iPL7UM8EE",
  });
  assert.equal(stopped.totalRuns, 1);
  assert.equal(stopped.durationSamples, 0);
  assert.equal(stopped.averageDurationMs, null);
  completed = true;
  console.log(
    JSON.stringify({
      workflowId: workflow.id,
      runId: run.id,
      emptyAverageIsNull: true,
      stoppedAverageIsNull: true,
      durationSamples: 1,
      averageDurationMs: measured.averageDurationMs,
      status: "success",
    })
  );
} finally {
  if (!completed)
    await admin
      .request("workflow.cancelRun", { runId: started.runId }, true)
      .catch(() => {});
}
