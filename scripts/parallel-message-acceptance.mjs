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
  { code: `MSGPAR_${tag}`.toUpperCase(), name: `并行消息验证_${tag}` },
  true
);
const node = (id, type, config = {}, x = 0, y = 0) => ({
  id,
  type,
  name: id,
  config,
  position: { x, y },
});
const edge = (sourceNodeId, targetNodeId, sourceHandle) => ({
  id: `${sourceNodeId}-${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
  ...(sourceHandle ? { sourceHandle } : {}),
});
for (const flowType of ["control", "state"]) {
  const nodes = [
    node("start", "start"),
    node(
      "router",
      "router",
      {
        nodeDh: "ROUTER",
        lymc: "等待外部消息",
        gbms: true,
        parallelJoinNodeId: "join",
        defaultRoute: "ma",
        routes: ["ma", "mb"].map(target => ({
          handle: target,
          label: target,
          targetNodeId: target,
          conditions: [],
        })),
      },
      250
    ),
    node(
      "ma",
      "message_catch",
      { messageName: "parallel.ready", correlationKey: `${tag}-a` },
      500
    ),
    node(
      "mb",
      "message_catch",
      { messageName: "parallel.ready", correlationKey: `${tag}-b` },
      500,
      180
    ),
    node(
      "a",
      "transform",
      {
        mappings: {
          value: "{{vars.ma.payload.value}}",
          otherSeen: "{{vars.mb.payload.value}}",
        },
      },
      750
    ),
    node(
      "b",
      "transform",
      {
        mappings: {
          value: "{{vars.mb.payload.value}}",
          otherSeen: "{{vars.ma.payload.value}}",
        },
      },
      750,
      180
    ),
    node(
      "join",
      "transform",
      {
        parallelForNodeId: "router",
        mappings: { a: "{{vars.a.value}}", b: "{{vars.b.value}}" },
      },
      1000
    ),
    node("end", "end", { resultTemplate: "{{vars.join}}" }, 1500),
  ];
  const edges = [
    edge("start", "router"),
    edge("router", "ma", "ma"),
    edge("router", "mb", "mb"),
    edge("ma", "a"),
    edge("mb", "b"),
    edge("a", "join"),
    edge("b", "join"),
    edge("join", "end"),
  ];
  if (flowType === "state") {
    nodes.push(
      node(
        "pending",
        "state",
        { stateCode: "PENDING", displayName: "待消息", stateType: "business" },
        120
      )
    );
    nodes.push(
      node(
        "done",
        "state",
        {
          stateCode: "DONE",
          displayName: "消息汇聚完成",
          stateType: "business",
        },
        1250
      )
    );
    edges.find(e => e.sourceNodeId === "start").targetNodeId = "pending";
    edges.push(edge("pending", "router"));
    edges.find(e => e.sourceNodeId === "join").targetNodeId = "done";
    edges.push(edge("done", "end"));
  }
  const workflow = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `并行消息_${flowType}_${tag}`,
      flowType,
      definition: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        nodes,
        edges,
      },
    },
    true
  );
  const started = await admin.request(
    "workflow.run",
    {
      workflowId: workflow.id,
      triggerType: "test",
      idempotencyKey: `msg-${flowType}-${tag}`,
    },
    true
  );
  let completed = false;
  try {
    await waitFor(
      () => admin.request("workflow.runDetail", { runId: started.runId }),
      run =>
        run.status === "waiting" &&
        run.nodeRuns.filter(
          n => n.status === "waiting" && ["ma", "mb"].includes(n.nodeId)
        ).length === 2,
      "two message subscriptions"
    );
    const signal = key =>
      admin.request(
        "task.signalMessage",
        {
          runId: started.runId,
          messageName: "parallel.ready",
          correlationKey: `${tag}-${key}`,
          payload: { value: key.toUpperCase() },
        },
        true
      );
    const responses = await Promise.allSettled([signal("a"), signal("b")]);
    assert.equal(
      responses.filter(r => r.status === "fulfilled").length,
      2,
      JSON.stringify({
        workflowId: workflow.id,
        runId: started.runId,
        errors: responses
          .filter(r => r.status === "rejected")
          .map(r => r.reason.message),
      })
    );
    await assert.rejects(() => signal("b"), /订阅|等待/);
    const result = await waitFor(
      () => admin.request("workflow.runDetail", { runId: started.runId }),
      run => ["success", "failed"].includes(run.status),
      "parallel message run"
    );
    assert.equal(result.status, "success", JSON.stringify(result.errorJson));
    const output = id =>
      result.nodeRuns
        .filter(n => n.nodeId === id && n.status === "success")
        .map(n =>
          typeof n.outputJson === "string"
            ? JSON.parse(n.outputJson)
            : n.outputJson
        );
    assert.deepEqual(output("a"), [{ value: "A" }]);
    assert.deepEqual(output("b"), [{ value: "B" }]);
    assert.deepEqual(output("join"), [{ a: "A", b: "B" }]);
    assert.deepEqual(output("end")[0].result, { a: "A", b: "B" });
    assert.equal(output("end").length, 1);
    if (flowType === "state") {
      assert.equal(result.currentStateCode, "DONE");
      assert.equal(result.stateVersion, 2);
    }
    completed = true;
    console.log(
      JSON.stringify({
        workflowId: workflow.id,
        runId: started.runId,
        flowType,
        concurrentMessages: 2,
        duplicateDenied: true,
        branchIsolation: true,
        joinCount: 1,
        status: "success",
      })
    );
  } finally {
    if (!completed)
      await admin
        .request("workflow.cancelRun", { runId: started.runId }, true)
        .catch(() => {});
  }
}
