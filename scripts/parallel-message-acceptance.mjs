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

const restartStage = process.env.FLOW_PARALLEL_MESSAGE_STAGE ?? "normal";
const publishedMode = process.env.FLOW_PARALLEL_PUBLISHED === "1";
assert(
  ["normal", "prepare", "resume", "cancel", "terminate", "pause"].includes(
    restartStage
  )
);
let restartFixture = null;
let restoredWorkflow = null;
if (restartStage === "resume") {
  const workflowId = process.env.FLOW_PARALLEL_MESSAGE_WORKFLOW_ID;
  const runId = process.env.FLOW_PARALLEL_MESSAGE_RUN_ID;
  assert(
    workflowId && runId,
    "Resume requires the exact workflow and run IDs emitted before restart"
  );
  restoredWorkflow = await admin.request("workflow.get", { id: workflowId });
  const match = /^并行消息_(state|control)_([a-f0-9]{8})$/.exec(restoredWorkflow.name);
  assert(match, "Resume is restricted to the isolated message fixture");
  assert.equal(restoredWorkflow.flowType, match[1]);
  const existingRun = await admin.request("workflow.runDetail", { runId });
  assert.equal(existingRun.workflowId, workflowId);
  restartFixture = {
    tag: match[2],
    projectId: restoredWorkflow.projectId,
    workflowId,
    runId,
    flowType: match[1],
  };
}
const tag = restartFixture?.tag ?? randomBytes(4).toString("hex");
const restartFlowType = restartFixture?.flowType ?? process.env.FLOW_PARALLEL_MESSAGE_FLOW_TYPE ?? "state";
assert(["state", "control"].includes(restartFlowType), "Restart flow type must be state or control");
const project = restartFixture
  ? { id: restartFixture.projectId }
  : await admin.request(
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
for (const flowType of ["normal", "cancel", "terminate", "pause"].includes(
  restartStage
)
  ? ["control", "state"]
  : [restartFlowType]) {
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
  const workflow = restartFixture
    ? restoredWorkflow
    : await admin.request(
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
  if (restartFixture) {
    assert.equal(workflow.projectId, restartFixture.projectId);
    assert.equal(workflow.name, `并行消息_${flowType}_${tag}`);
  }
  if (publishedMode && !restartFixture) {
    await admin.request("project.auditWorkflow", { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" }, true);
    await admin.request("workflow.publish", { id: workflow.id }, true);
  }
  const started = restartFixture
    ? { runId: restartFixture.runId }
    : await admin.request(
        "workflow.run",
        {
          workflowId: workflow.id,
          triggerType: publishedMode ? "manual" : "test",
          idempotencyKey: `msg-${flowType}-${tag}`,
        },
        true
      );
  let completed = false;
  try {
    const waiting = await waitFor(
      () => admin.request("workflow.runDetail", { runId: started.runId }),
      run =>
        run.status === "waiting" &&
        run.nodeRuns.filter(
          n => n.status === "waiting" && ["ma", "mb"].includes(n.nodeId)
        ).length === 2,
      "two message subscriptions"
    );
    if (["prepare", "resume"].includes(restartStage)) {
      if (publishedMode) assert.equal(waiting.executionSource, "published_plan");
      if (flowType === "state") {
        assert.equal(waiting.currentStateCode, "PENDING");
        assert.equal(waiting.stateVersion, 1);
      }
    }
    if (restartStage === "prepare") {
      completed = true;
      console.log(
        JSON.stringify({
          stage: "restart-prepared",
          workflowId: workflow.id,
          runId: started.runId,
          waitingMessages: 2,
          publishedMode,
          flowType,
          currentStateCode: waiting.currentStateCode,
          stateVersion: waiting.stateVersion,
        })
      );
      continue;
    }
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
    if (restartStage === "pause") {
      const pauses = await Promise.all([
        admin.request("workflow.pauseRun", { runId: started.runId }, true),
        admin.request("workflow.pauseRun", { runId: started.runId }, true),
      ]);
      assert.equal(pauses.filter(result => result.changed).length, 1);
      const paused = await admin.request("workflow.runDetail", {
        runId: started.runId,
      });
      assert.equal(paused.status, "blocked");
      assert.equal(paused.nodeRuns.length, waiting.nodeRuns.length);
      assert.equal(paused.stateVersion, waiting.stateVersion);
      await assert.rejects(() => signal("a"), /等待状态|暂停/);
      const resumed = await admin.request(
        "workflow.resumeRun",
        { runId: started.runId },
        true
      );
      assert.equal(resumed.changed, true);
      const repeated = await admin.request(
        "workflow.resumeRun",
        { runId: started.runId },
        true
      );
      assert.equal(repeated.changed, false);
      const restored = await waitFor(
        () => admin.request("workflow.runDetail", { runId: started.runId }),
        run => run.status === "waiting",
        "restored parallel subscriptions"
      );
      assert.equal(restored.nodeRuns.length, waiting.nodeRuns.length);
      assert.equal(restored.stateVersion, waiting.stateVersion);
      assert.equal(restored.currentStateCode, waiting.currentStateCode);
    }
    if (["cancel", "terminate"].includes(restartStage)) {
      const controlMethod =
        restartStage === "terminate"
          ? "workflow.terminateRun"
          : "workflow.cancelRun";
      const targetStatus =
        restartStage === "terminate" ? "terminated" : "cancelled";
      await signal("a");
      const beforeCancel = await waitFor(
        () => admin.request("workflow.runDetail", { runId: started.runId }),
        run =>
          run.status === "waiting" &&
          run.nodeRuns.some(n => n.nodeId === "a" && n.status === "success"),
        "first branch completed while second waits"
      );
      const cancelled = await admin.request(
        controlMethod,
        { runId: started.runId, reason: "隔离验收主动停止" },
        true
      );
      assert.equal(cancelled.status, targetStatus);
      assert.equal(cancelled.changed, true);
      const stoppedSnapshot = await admin.request("workflow.runDetail", {
        runId: started.runId,
      });
      const repeated = await admin.request(
        controlMethod,
        { runId: started.runId, reason: "隔离验收主动停止" },
        true
      );
      assert.equal(repeated.changed, false);
      const late = await Promise.allSettled([signal("b"), signal("b")]);
      assert.equal(late.filter(item => item.status === "fulfilled").length, 0);
      assert(
        late.every(
          item =>
            item.status === "rejected" &&
            /订阅|等待|取消|终止/.test(item.reason.message)
        )
      );
      const afterCancel = await admin.request("workflow.runDetail", {
        runId: started.runId,
      });
      assert.equal(afterCancel.status, targetStatus);
      assert.equal(afterCancel.endReason, targetStatus);
      assert.equal(typeof afterCancel.durationMs, "number");
      assert(afterCancel.durationMs >= 0);
      assert.equal(afterCancel.durationMs, stoppedSnapshot.durationMs);
      assert.equal(
        String(afterCancel.finishedAt),
        String(stoppedSnapshot.finishedAt)
      );
      assert.equal(afterCancel.nodeRuns.length, beforeCancel.nodeRuns.length);
      assert.equal(
        afterCancel.nodeRuns.some(n =>
          ["join", "done", "end"].includes(n.nodeId)
        ),
        false
      );
      assert.equal(afterCancel.stateVersion, beforeCancel.stateVersion);
      assert.equal(afterCancel.currentStateCode, beforeCancel.currentStateCode);
      completed = true;
      console.log(
        JSON.stringify({
          workflowId: workflow.id,
          runId: started.runId,
          flowType,
          firstBranchCompleted: true,
          lateMessagesDenied: 2,
          controlIdempotent: true,
          noJoinOrEnd: true,
          status: targetStatus,
        })
      );
      continue;
    }
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
    if (publishedMode) assert.equal(result.executionSource, "published_plan");
    const output = id =>
      result.nodeRuns
        .filter(n => n.nodeId === id && n.status === "success")
        .map(n =>
          typeof n.outputJson === "string"
            ? JSON.parse(n.outputJson)
            : n.outputJson
        );
    for (const nodeId of ["start", "router", "ma", "mb"])
      assert.equal(output(nodeId).length, 1, `${nodeId} must execute once`);
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
        publishedMode,
        restartResumeStage: restartStage === "resume",
        pauseResumeVerified: restartStage === "pause",
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
