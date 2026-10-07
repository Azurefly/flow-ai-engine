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
  { code: `MSGKEY_${tag}`.toUpperCase(), name: `消息相关键测试_${tag}` },
  true
);
const workflow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `消息业务编号_${tag}`,
    flowType: "control",
    definition: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: [
        {
          id: "start",
          type: "start",
          name: "开始",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "message",
          type: "message_catch",
          name: "等待订单消息",
          config: {
            messageName: "order.paid",
            correlationKey: "{{input.businessKey}}",
          },
          position: { x: 300, y: 0 },
        },
        {
          id: "end",
          type: "end",
          name: "结束",
          config: { resultTemplate: "{{vars.message.payload}}" },
          position: { x: 600, y: 0 },
        },
      ],
      edges: [
        { id: "s-m", sourceNodeId: "start", targetNodeId: "message" },
        { id: "m-e", sourceNodeId: "message", targetNodeId: "end" },
      ],
    },
  },
  true
);
for (const item of [
  { name: "object", key: { orderId: "42" }, valid: false },
  { name: "array", key: ["42"], valid: false },
  { name: "missing", valid: false },
  { name: "empty", key: "", valid: false },
  { name: "overlength", key: "x".repeat(256), valid: false },
  { name: "unsafe-number", key: Number.MAX_SAFE_INTEGER + 1, valid: false },
  { name: "zero", key: 0, valid: true },
  { name: "text", key: " ORDER-42 ", valid: true },
]) {
  const started = await admin.request(
    "workflow.run",
    {
      workflowId: workflow.id,
      input: { businessKey: item.key },
      triggerType: "test",
      idempotencyKey: `key-${tag}-${item.name}`,
    },
    true
  );
  let completed = false;
  try {
    const read = () =>
      admin.request("workflow.runDetail", { runId: started.runId });
    let result = await waitFor(
      read,
      run => ["waiting", "failed", "success"].includes(run.status),
      item.name
    );
    if (!item.valid) {
      assert.equal(result.status, "failed");
      assert.match(JSON.stringify(result.errorJson), /相关键/);
      assert.equal(
        result.nodeRuns.some(n => n.nodeId === "end"),
        false
      );
    } else {
      assert.equal(result.status, "waiting");
      await admin.request(
        "task.signalMessage",
        {
          runId: started.runId,
          messageName: "order.paid",
          correlationKey: String(item.key).trim(),
          payload: { accepted: true },
        },
        true
      );
      result = await waitFor(
        read,
        run => ["success", "failed"].includes(run.status),
        `${item.name}-resumed`
      );
      assert.equal(result.status, "success");
      const end = result.nodeRuns.filter(n => n.nodeId === "end");
      assert.equal(end.length, 1);
      const output =
        typeof end[0].outputJson === "string"
          ? JSON.parse(end[0].outputJson)
          : end[0].outputJson;
      assert.deepEqual(output.result, { accepted: true });
    }
    completed = true;
    console.log(
      JSON.stringify({
        workflowId: workflow.id,
        runId: started.runId,
        case: item.name,
        status: result.status,
      })
    );
  } finally {
    if (!completed)
      await admin
        .request("workflow.cancelRun", { runId: started.runId }, true)
        .catch(() => {});
  }
}
