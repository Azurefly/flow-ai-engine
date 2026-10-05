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
  { code: `FUNCTION_${tag}`, name: `内置函数测试_${tag}` },
  true
);
const source = await admin.request(
  "data.createSource",
  {
    projectId: project.id,
    name: "内联函数测试源",
    sourceType: "inline",
    connection: {},
  },
  true
);
const left = await admin.request(
  "data.createAsset",
  {
    projectId: project.id,
    sourceId: source.id,
    name: "左表",
    assetType: "dataset",
    schema: [
      { name: "id", type: "number" },
      { name: "text", type: "string" },
    ],
    sample: [
      { id: 1, text: "left" },
      { id: 2, text: "unmatched" },
    ],
  },
  true
);
const right = await admin.request(
  "data.createAsset",
  {
    projectId: project.id,
    sourceId: source.id,
    name: "右表",
    assetType: "dataset",
    schema: [
      { name: "id", type: "number" },
      { name: "text", type: "string" },
    ],
    sample: [{ id: 1, text: "right" }],
  },
  true
);
const udf = await admin.request(
  "data.createUdf",
  {
    projectId: project.id,
    name: "右侧文本大写",
    udfType: "javascript",
    artifactRef: "builtin:upper",
    params: [],
    returnType: "string",
  },
  true
);
await admin.request(
  "data.updateUdf",
  { projectId: project.id, udfId: udf.id, status: "approved" },
  true
);
const specs = [
  ["start", "start", {}],
  ["left", "source", { assetId: left.id }],
  ["right", "source", { assetId: right.id }],
  [
    "join",
    "join",
    {
      kind: "left",
      leftInputNodeId: "left",
      rightInputNodeId: "right",
      leftKeys: ["id"],
      rightKeys: ["id"],
      rightPrefix: "lookup_",
    },
  ],
  [
    "upper",
    "udf",
    { udfId: udf.id, inputField: "lookup_text", outputField: "normalized" },
  ],
  ["end", "end", {}],
];
const links = [
  ["s-left", "start", "left"],
  ["s-right", "start", "right"],
  ["a-right", "right", "join"],
  ["z-left", "left", "join"],
  ["join-upper", "join", "upper"],
  ["upper-end", "upper", "end"],
];
const workflow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `关联函数_${tag}`,
    flowType: "data",
    definition: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: specs.map(([id, type, config], i) => ({
        id,
        type,
        config,
        name: id,
        position: { x: i * 180, y: 0 },
      })),
      edges: links.map(([id, sourceNodeId, targetNodeId]) => ({
        id,
        sourceNodeId,
        targetNodeId,
      })),
    },
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
      runId: started.runId ?? started.id,
    }),
  value => ["success", "failed"].includes(value.status),
  "joined run"
);
assert.equal(run.status, "success");
assert.deepEqual(run.output.terminals[0].rows, [
  {
    id: 1,
    text: "left",
    lookup_id: 1,
    lookup_text: "right",
    normalized: "RIGHT",
  },
  {
    id: 2,
    text: "unmatched",
    lookup_id: null,
    lookup_text: null,
    normalized: null,
  },
]);
console.log(
  JSON.stringify({
    projectId: project.id,
    workflowId: workflow.id,
    runId: run.id,
    status: run.status,
  })
);
