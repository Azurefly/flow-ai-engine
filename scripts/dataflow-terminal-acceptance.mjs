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

const before = process.env.FLOW_TERMINAL_STAGE === "before";
const source = await admin.request("workflow.get", { id: "13ngFTbBGI46Ibia" });
assert.match(source.name, /^去重聚合质量门测试_/);
const old =
  typeof source.definition === "string"
    ? JSON.parse(source.definition)
    : source.definition;
const assetId = old.nodes.find(n => n.type === "source").config.assetId;
const tag = randomBytes(4).toString("hex");
for (const type of before ? ["output"] : ["output", "sink"]) {
  const specs = [
    ["start", "start", {}],
    ["source", "source", { assetId, limit: 100 }],
    ["map", "map", { columns: ["amount"], limit: 100 }],
    [
      "terminal",
      type,
      {
        outputName: "金额明细",
        ...(type === "sink"
          ? { writeMode: "audit_only", idempotencyKey: `audit-${tag}` }
          : {}),
      },
    ],
  ];
  const create = () =>
    admin.request(
      "project.createWorkflow",
      {
        projectId: source.projectId,
        name: `数据终点验证_${type}_${tag}`,
        flowType: "data",
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
          edges: specs.slice(1).map(([id], i) => ({
            id: `e${i}`,
            sourceNodeId: specs[i][0],
            targetNodeId: id,
          })),
        },
      },
      true
    );
  if (before) {
    await assert.rejects(create, /一个结束节点/);
    console.log(
      JSON.stringify({
        case: "output-without-end",
        status: "reproduced-creation-rejection",
      })
    );
    continue;
  }
  const workflow = await create();
  await admin.request(
    "project.auditWorkflow",
    {
      projectId: source.projectId,
      workflowId: workflow.id,
      auditStatus: "approved",
    },
    true
  );
  await admin.request("workflow.publish", { id: workflow.id }, true);
  const started = await admin.request(
    "data.run",
    { projectId: source.projectId, workflowId: workflow.id },
    true
  );
  const run = await waitFor(
    () =>
      admin.request("data.runDetail", {
        projectId: source.projectId,
        runId: started.runId,
      }),
    value => ["success", "failed"].includes(value.status),
    type
  );
  assert.equal(run.status, "success");
  assert.equal(run.executionSource, "published_plan");
  assert.equal(run.output.terminals.length, 1);
  assert.equal(run.output.terminals[0].nodeId, "terminal");
  assert.equal(run.output.terminals[0].outputName, "金额明细");
  assert.equal(run.output.terminals[0].rows.length, 6);
  assert.equal(
    run.nodeRuns.some(n => n.nodeType === "end"),
    false
  );
  console.log(
    JSON.stringify({
      workflowId: workflow.id,
      runId: run.id,
      terminalType: type,
      hasExtraEnd: false,
      rows: 6,
      executionSource: run.executionSource,
      status: "success",
    })
  );
}
