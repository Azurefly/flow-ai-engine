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
  { code: `QUALITY_${tag}`, name: `稀疏数据质量测试_${tag}` },
  true
);
const source = await admin.request(
  "data.createSource",
  {
    projectId: project.id,
    name: "独立内联测试源",
    sourceType: "inline",
    connection: { description: "隔离质量测试" },
  },
  true
);
const rows = [{ name: "甲" }, { amount: 10 }];
const asset = await admin.request(
  "data.createAsset",
  {
    projectId: project.id,
    sourceId: source.id,
    name: "缺失字段测试",
    assetType: "dataset",
    schema: [
      { name: "name", type: "string" },
      { name: "amount", type: "number" },
    ],
    sample: rows,
  },
  true
);
for (const { minRows, maxNullRate, expectedStatus, errorPattern } of [
  {
    minRows: 1,
    maxNullRate: 0.25,
    expectedStatus: "failed",
    errorPattern: /空值率 0.5000/,
  },
  { minRows: 1, maxNullRate: 0.5, expectedStatus: "success" },
  {
    minRows: 1,
    maxNullRate: 1.1,
    expectedStatus: "failed",
    errorPattern: /最大空值率/,
  },
  {
    minRows: 1,
    maxNullRate: -0.1,
    expectedStatus: "failed",
    errorPattern: /最大空值率/,
  },
  {
    minRows: 1.5,
    maxNullRate: 1,
    expectedStatus: "failed",
    errorPattern: /最少行数/,
  },
  {
    minRows: -1,
    maxNullRate: 1,
    expectedStatus: "failed",
    errorPattern: /最少行数/,
  },
]) {
  const specs = [
    ["start", "start", {}],
    ["source", "source", { assetId: asset.id, limit: 100 }],
    ["quality", "quality_gate", { minRows, maxNullRate }],
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
    edges: specs.slice(1).map(([id], index) => ({
      id: `edge-${index}`,
      sourceNodeId: specs[index][0],
      targetNodeId: id,
    })),
  };
  const workflow = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `质量门_${maxNullRate}_${tag}`,
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
    "quality test finished"
  );
  assert.equal(run.status, expectedStatus);
  if (run.status === "success")
    assert.deepEqual(run.output.terminals[0].rows, rows);
  else assert.match(JSON.stringify(run), errorPattern);
  console.log(
    JSON.stringify({
      projectId: project.id,
      workflowId: workflow.id,
      runId: run.id,
      minRows,
      maxNullRate,
      status: run.status,
    })
  );
}
