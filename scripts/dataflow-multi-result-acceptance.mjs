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

const stage = process.env.FLOW_MULTI_RESULT_STAGE ?? "verify";
assert(["prepare", "verify"].includes(stage));
if (stage === "prepare") {
  const sourceWorkflow = await admin.request("workflow.get", {
    id: "13ngFTbBGI46Ibia",
  });
  assert.match(sourceWorkflow.name, /^去重聚合质量门测试_[a-f0-9]{8}$/);
  const definition =
    typeof sourceWorkflow.definition === "string"
      ? JSON.parse(sourceWorkflow.definition)
      : sourceWorkflow.definition;
  const assetId = definition.nodes.find(n => n.type === "source").config
    .assetId;
  assert(assetId);
  const tag = randomBytes(4).toString("hex");
  const specs = [
    ["start", "start", "开始", {}],
    ["source", "source", "内联测试数据", { assetId, limit: 100 }],
    ["left", "map", "业务键投影", { columns: ["key"], limit: 100 }],
    ["right", "map", "金额投影", { columns: ["amount"], limit: 100 }],
    ["end", "end", "业务键结果", {}],
    ["output", "output", "金额结果", {}],
  ];
  const workflow = await admin.request(
    "project.createWorkflow",
    {
      projectId: sourceWorkflow.projectId,
      name: `多结果集表格验证_${tag}`,
      flowType: "data",
      definition: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        nodes: specs.map(([id, type, name, config], i) => ({
          id,
          type,
          name,
          config,
          position: { x: Math.min(i, 3) * 240, y: (i % 2) * 160 },
        })),
        edges: [
          ["start", "source"],
          ["source", "left"],
          ["source", "right"],
          ["left", "end"],
          ["right", "output"],
        ].map(([sourceNodeId, targetNodeId]) => ({
          id: `${sourceNodeId}-${targetNodeId}`,
          sourceNodeId,
          targetNodeId,
        })),
      },
    },
    true
  );
  console.log(
    JSON.stringify({
      stage: "prepared",
      workflowId: workflow.id,
      projectId: sourceWorkflow.projectId,
      resultNames: ["业务键结果", "金额结果"],
    })
  );
} else {
  const workflowId = process.env.FLOW_UI_WORKFLOW_ID;
  const runPrefix = process.env.FLOW_UI_RUN_PREFIX;
  assert(workflowId && runPrefix);
  const workflow = await admin.request("workflow.get", { id: workflowId });
  assert.match(workflow.name, /^多结果集表格验证_[a-f0-9]{8}$/);
  const matches = (
    await admin.request("data.runs", {
      projectId: workflow.projectId,
      workflowId,
      limit: 10,
      summaryOnly: true,
    })
  ).filter(run => run.id.startsWith(runPrefix));
  assert.equal(matches.length, 1);
  const run = await waitFor(
    () =>
      admin.request("data.runDetail", {
        projectId: workflow.projectId,
        runId: matches[0].id,
      }),
    value => ["success", "failed"].includes(value.status),
    "browser multiple-result run"
  );
  assert.equal(run.status, "success");
  assert.equal(run.output.terminals.length, 2);
  const left = run.output.terminals.find(t => t.nodeName === "业务键结果");
  const right = run.output.terminals.find(t => t.nodeName === "金额结果");
  assert(left && right);
  assert.equal(left.rows.length, 6);
  assert.equal(right.rows.length, 6);
  assert(left.rows.every(row => Object.keys(row).join() === "key"));
  assert(right.rows.every(row => Object.keys(row).join() === "amount"));
  console.log(
    JSON.stringify({
      workflowId,
      runId: run.id,
      resultSets: 2,
      names: [left.nodeName, right.nodeName],
      rowCounts: [6, 6],
      status: "success",
    })
  );
}
