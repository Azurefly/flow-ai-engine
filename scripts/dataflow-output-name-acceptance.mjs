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

const sourceWorkflow = await admin.request("workflow.get", {
  id: "13ngFTbBGI46Ibia",
});
assert.match(sourceWorkflow.name, /^去重聚合质量门测试_[a-f0-9]{8}$/);
const sourceDefinition =
  typeof sourceWorkflow.definition === "string"
    ? JSON.parse(sourceWorkflow.definition)
    : sourceWorkflow.definition;
const assetId = sourceDefinition.nodes.find(n => n.type === "source").config
  .assetId;
const tag = randomBytes(4).toString("hex");
for (const item of [
  { name: "named-chain", outputName: "金额明细", named: true },
  { name: "trimmed-chain", outputName: "  金额明细  ", named: true },
  { name: "plain-end", named: false },
  { name: "empty-name", outputName: "   ", named: true, invalid: true },
]) {
  const specs = [
    ["start", "start", {}],
    ["source", "source", { assetId, limit: 100 }],
    ["map", "map", { columns: ["amount"], limit: 100 }],
    ...(item.named
      ? [["output", "output", { outputName: item.outputName }]]
      : []),
    ["end", "end", {}],
  ];
  const workflow = await admin.request(
    "project.createWorkflow",
    {
      projectId: sourceWorkflow.projectId,
      name: `输出名称串联测试_${item.name}_${tag}`,
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
  if (item.invalid) {
    await assert.rejects(
      () =>
        admin.request(
          "data.run",
          { projectId: sourceWorkflow.projectId, workflowId: workflow.id },
          true
        ),
      /输出名称/
    );
    console.log(
      JSON.stringify({
        workflowId: workflow.id,
        case: item.name,
        status: "rejected-before-run",
      })
    );
    continue;
  }
  const started = await admin.request(
    "data.run",
    { projectId: sourceWorkflow.projectId, workflowId: workflow.id },
    true
  );
  const run = await waitFor(
    () =>
      admin.request("data.runDetail", {
        projectId: sourceWorkflow.projectId,
        runId: started.runId,
      }),
    value => ["success", "failed"].includes(value.status),
    item.name
  );
  assert.equal(run.status, "success");
  assert.equal(run.output.terminals.length, 1);
  assert.equal(run.output.terminals[0].rows.length, 6);
  assert.equal(
    run.output.terminals[0].outputName,
    item.named ? "金额明细" : undefined
  );
  if (item.named)
    assert.equal(
      run.nodeRuns.find(n => n.nodeId === "output").output.outputName,
      "金额明细"
    );
  console.log(
    JSON.stringify({
      workflowId: workflow.id,
      runId: run.id,
      case: item.name,
      outputName: run.output.terminals[0].outputName ?? null,
      rows: 6,
      status: "success",
    })
  );
}
