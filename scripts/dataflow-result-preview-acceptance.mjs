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
  { code: `PREVIEW_${tag}`, name: `结果分页测试_${tag}` },
  true
);
assert.equal(
  (await admin.request("project.get", { projectId: project.id })).id,
  project.id
);
assert.equal(
  await admin.request("project.get", { projectId: "missing-project-fixture" }),
  null
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
const samples = Array.from({ length: 23 }, (_, id) => ({
  id,
  title: `row-${id}`,
  ...(id === 15
    ? { lateField: "later-row", a: 1, b: 2, c: 3, d: 4, e: 5 }
    : {}),
}));
const asset = await admin.request(
  "data.createAsset",
  {
    projectId: project.id,
    sourceId: source.id,
    name: "分页与稀疏字段样本",
    assetType: "dataset",
    schema: [
      { name: "id", type: "number" },
      { name: "title", type: "string" },
    ],
    sample: samples,
  },
  true
);
const specs = [
  ["start", "start", {}],
  ["source", "source", { assetId: asset.id, limit: 100 }],
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
    name: `结果分页测试_${tag}`,
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
  "preview fixture finished"
);
assert.equal(run.status, "success", JSON.stringify(run.error));
assert.deepEqual(run.output.terminals[0].rows, samples);
const verifyUnpublish = process.env.FLOW_DATA_UNPUBLISH === "1";
if (verifyUnpublish) {
  const versions = await admin.request("workflow.versions", { workflowId: workflow.id });
  assert(versions.length > 0);
  await admin.request("workflow.unpublish", { id: workflow.id }, true);
  await assert.rejects(() => admin.request("data.run", { projectId: project.id, workflowId: workflow.id }, true), /未发布/);
  const after = await admin.request("workflow.versions", { workflowId: workflow.id });
  for (const version of versions) assert(after.some(item => item.id === version.id));
  const retained = await admin.request("data.runDetail", { projectId: project.id, runId: started.runId });
  assert.equal(retained.status, "success");
  assert.deepEqual(retained.output.terminals[0].rows, samples);
  const draftTest = await admin.request("data.run", { projectId: project.id, workflowId: workflow.id, mode: "test" }, true);
  const draftResult = await admin.request("data.runDetail", { projectId: project.id, runId: draftTest.runId });
  assert.equal(draftResult.status, "success");
  assert.equal(draftResult.executionSource, "draft");
  assert.deepEqual(draftResult.output.terminals[0].rows, samples);
}
console.log(
  JSON.stringify({
    projectId: project.id,
    workflowId: workflow.id,
    runId: run.id,
    rows: samples.length,
    lateFieldRow: 15,
    fields: 8,
    unpublishLifecycleVerified: verifyUnpublish,
    explicitDraftTestVerified: verifyUnpublish,
  })
);
