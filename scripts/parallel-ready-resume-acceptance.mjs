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

const source = await admin.request("workflow.get", { id: "wEjEcT-FUPIDrEUx" });
assert.match(source.name, /^并行消息_state_[a-f0-9]{8}$/);
let captured = false;
for (let attempt = 0; attempt < 12 && !captured; attempt++) {
  const tag = randomBytes(4).toString("hex");
  const definition = structuredClone(
    typeof source.definition === "string"
      ? JSON.parse(source.definition)
      : source.definition
  );
  assert(
    definition.nodes.every(n =>
      [
        "start",
        "state",
        "router",
        "message_catch",
        "transform",
        "end",
      ].includes(n.type)
    )
  );
  for (const node of definition.nodes.filter(n => n.type === "message_catch"))
    node.config.correlationKey = `${tag}-${node.id === "ma" ? "a" : "b"}`;
  const workflow = await admin.request(
    "project.createWorkflow",
    {
      projectId: source.projectId,
      name: `就绪队列恢复验证_${tag}`,
      flowType: "state",
      definition,
    },
    true
  );
  const started = await admin.request(
    "workflow.run",
    {
      workflowId: workflow.id,
      triggerType: "test",
      idempotencyKey: `ready-${tag}`,
    },
    true
  );
  let completed = false;
  try {
    const read = () =>
      admin.request("workflow.runDetail", { runId: started.runId });
    await waitFor(
      read,
      run =>
        run.status === "waiting" &&
        run.nodeRuns.filter(n => n.status === "waiting").length === 2,
      "two message waits"
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
    const race = await Promise.allSettled([
      signal("a"),
      admin.request("workflow.pauseRun", { runId: started.runId }, true),
    ]);
    const paused = await read();
    const context =
      typeof paused.contextJson === "string"
        ? JSON.parse(paused.contextJson)
        : paused.contextJson;
    const queue = context?.runtime?.executionQueue ?? [];
    if (
      race.some(r => r.status === "rejected") ||
      paused.status !== "blocked" ||
      !queue.includes("a")
    ) {
      console.log(JSON.stringify({ attempt, readyQueueCaptured: false }));
      continue;
    }
    captured = true;
    console.log(
      JSON.stringify({
        workflowId: workflow.id,
        runId: started.runId,
        readyQueueCaptured: true,
        queue,
      })
    );
    const resumed = await admin.request(
      "workflow.resumeRun",
      { runId: started.runId },
      true
    );
    assert.equal(
      resumed.status,
      "queued",
      "An active wait must not suppress ready-node resumption"
    );
    const aDone = await waitFor(
      read,
      run =>
        run.status === "waiting" &&
        run.nodeRuns.some(n => n.nodeId === "a" && n.status === "success"),
      "ready branch runs before second message"
    );
    assert.equal(
      aDone.nodeRuns.some(n => n.nodeId === "b" && n.status === "success"),
      false
    );
    await signal("b");
    const result = await waitFor(
      read,
      run => ["success", "failed"].includes(run.status),
      "parallel ready completion"
    );
    assert.equal(result.status, "success");
    assert.equal(
      result.nodeRuns.filter(n => n.nodeId === "join" && n.status === "success")
        .length,
      1
    );
    assert.equal(result.stateVersion, 2);
    completed = true;
    console.log(
      JSON.stringify({
        workflowId: workflow.id,
        runId: started.runId,
        readyBranchBeforeOtherMessage: true,
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
assert(
  captured,
  "Race setup did not capture a paused ready queue; no success claim is permitted"
);
