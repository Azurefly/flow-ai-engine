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
const tag = randomBytes(4).toString("hex");
const project = await admin.request(
  "project.create",
  { code: `DEDUP_${tag}`, name: `数据去重链路测试_${tag}` },
  true
);
const source = await admin.request(
  "data.createSource",
  {
    projectId: project.id,
    name: "独立内联测试源",
    sourceType: "inline",
    connection: { description: "隔离功能测试数据" },
  },
  true
);
const samples = [
  { key: { a: 1, b: 2 }, amount: 10 },
  { key: { b: 2, a: 1 }, amount: 999 },
  { key: "1", amount: 20 },
  { key: 1, amount: 30 },
  { key: null, amount: 40 },
  { key: null, amount: 888 },
];
const asset = await admin.request(
  "data.createAsset",
  {
    projectId: project.id,
    sourceId: source.id,
    name: "去重测试数据",
    assetType: "dataset",
    schema: [
      { name: "key", type: "json" },
      { name: "amount", type: "number" },
    ],
    sample: samples,
  },
  true
);
const specs = [
  ["start", "start", {}],
  ["source", "source", { assetId: asset.id, limit: 100 }],
  ["dedup", "deduplicate", { keys: [" key "] }],
  [
    "summary",
    "aggregate",
    {
      groupBy: [],
      metrics: [
        { name: "count", operation: "count" },
        { name: "total", operation: "sum", field: "amount" },
      ],
    },
  ],
  ["quality", "quality_gate", { minRows: 1, maxNullRate: 0 }],
  ["end", "end", {}],
];
const definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: specs.map(([id, type, config], index) => ({
    id,
    type,
    name: id,
    config,
    position: { x: index * 200, y: 0 },
  })),
  edges: specs
    .slice(1)
    .map(([id], index) => ({
      id: `edge-${index}`,
      sourceNodeId: specs[index][0],
      targetNodeId: id,
    })),
};
const workflow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `去重聚合质量门测试_${tag}`,
    flowType: "data",
    definition,
  },
  true
);
await admin.request(
  "project.auditWorkflow",
  { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" },
  true
);
await admin.request("workflow.publish", { id: workflow.id }, true);
const started = await admin.request(
  "data.run",
  { projectId: project.id, workflowId: workflow.id },
  true
);
const run = await waitFor(
  () =>
    admin.request("data.runDetail", {
      projectId: project.id,
      runId: started.runId,
    }),
  r => ["success", "failed"].includes(r.status),
  "dataflow finished"
);
assert.equal(run.status, "success", JSON.stringify(run.error));
const dedup = run.nodeRuns.find(n => n.nodeId === "dedup");
assert.equal(dedup.rowCount, 4);
assert.equal(dedup.output.rows[0].amount, 10);
assert.deepEqual(run.output.terminals[0].rows, [{ count: 4, total: 100 }]);
console.log(
  JSON.stringify({
    projectId: project.id,
    workflowId: workflow.id,
    runId: run.id,
    status: run.status,
    sourceRows: samples.length,
    deduplicatedRows: dedup.rowCount,
    summary: run.output.terminals[0].rows,
  })
);
