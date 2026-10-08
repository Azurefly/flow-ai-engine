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
const humanBranch = process.env.FLOW_READY_BRANCH === "human";
const actor = humanBranch ? await admin.request("auth.me", null) : null;
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
  if (humanBranch) {
    const taskNode = definition.nodes.find(n => n.id === "mb");
    taskNode.type = "operate";
    taskNode.config = {
      nodeDh: "HUMAN_B",
      czmc: "人工确认",
      instruction: "隔离并行恢复验收",
      assigneeMode: "user",
      assigneeUserId: actor.id,
      outcomeMode: "explicit",
      outcomes: [
        { code: "approved", label: "同意", sourceHandle: "approved" },
        { code: "rejected", label: "拒绝", sourceHandle: "rejected" },
      ],
      formSchema: { fields: [] },
    };
    definition.nodes.find(n => n.id === "b").config = {
      mappings: { value: "B", otherSeen: "{{vars.ma.payload.value}}" },
    };
    definition.edges = definition.edges.filter(
      edge => edge.sourceNodeId !== "mb"
    );
    for (const outcome of ["approved", "rejected"])
      definition.edges.push({
        id: `mb-b-${outcome}`,
        sourceNodeId: "mb",
        targetNodeId: "b",
        sourceHandle: outcome,
      });
  }
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
      (async () => {
        if (humanBranch)
          await new Promise(resolve => setTimeout(resolve, (attempt % 6) * 5));
        return admin.request(
          "workflow.pauseRun",
          { runId: started.runId },
          true
        );
      })(),
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
      console.log(
        JSON.stringify({
          attempt,
          readyQueueCaptured: false,
          status: paused.status,
          queue,
          errors: race
            .filter(r => r.status === "rejected")
            .map(r => r.reason.message),
        })
      );
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
    if (humanBranch) {
      const ownTasks = (
        await admin.request("task.list", {
          view: "todo",
          projectId: source.projectId,
        })
      ).filter(task => task.runId === started.runId && task.nodeId === "mb");
      assert.equal(ownTasks.length, 1);
      await admin.request(
        "task.execute",
        {
          taskId: ownTasks[0].id,
          result: {
            decision: "approved",
            outcome: "approved",
            comment: "隔离人工分支恢复验收",
          },
        },
        true
      );
    } else await signal("b");
    const result = await waitFor(
      read,
      run => ["success", "failed"].includes(run.status),
      "parallel ready completion"
    );
    assert.equal(result.status, "success");
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
        readyBranchBeforeOtherMessage: !humanBranch,
        readyBranchBeforeHumanDecision: humanBranch,
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
