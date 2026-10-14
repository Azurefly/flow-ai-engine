import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";

const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
    // Fixture writes explicitly submit the revision just inspected; callers may supply an older revision to test conflicts.
    if (["workflow.update", "workflow.publish", "workflow.unpublish"].includes(path) && input?.id && input.expectedDefinitionVersion === undefined) {
      const current = await request("workflow.get", { id: input.id });
      input = { ...input, expectedDefinitionVersion: Number(current.definitionVersion) };
    }

  const body = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(
    `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body } : {}),
    }
  );
  const nextCookie = response.headers.getSetCookie()[0];
  if (nextCookie) cookie = nextCookie.split(";", 1)[0];
  const payload = await response.json();
  if (!response.ok || payload.error)
    throw new Error(
      `${path}: ${payload.error?.json?.message ?? response.status}`
    );
  return superjson.deserialize(payload.result.data);
}
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(username && password, "Missing existing login configuration");
await request("auth.login", { username, password }, true);
const actor = await request("auth.me", null);
const read = value => (typeof value === "string" ? JSON.parse(value) : value);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(runId, accept, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const run = await request("workflow.runDetail", { runId });
    if (accept(run)) return run;
    assert(
      !["failed", "cancelled", "terminated"].includes(run.status),
      `${label}: ${JSON.stringify(run.errorJson)}`
    );
    await delay(1000);
  }
  throw new Error(`Timed out: ${label}`);
}
const node = (id, type, config = {}, x = 0) => ({
  id,
  type,
  name: id,
  config,
  position: { x, y: 0 },
});
const edge = (sourceNodeId, targetNodeId) => ({
  id: `${sourceNodeId}-${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
});
const stage = process.env.FLOW_ATOMIC_STAGE ?? "normal";
assert(["prepare", "resume", "normal"].includes(stage));
const tag = randomBytes(4).toString("hex");
async function create(name, nodes, edges) {
  const project = await request(
    "project.create",
    { code: `ATOMIC_${randomBytes(4).toString("hex")}`.toUpperCase(), name },
    true
  );
  const workflow = await request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name,
      flowType: "control",
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
  await request(
    "project.auditWorkflow",
    { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" },
    true
  );
  await request("workflow.publish", { id: workflow.id }, true);
  const { runId } = await request(
    "workflow.run",
    {
      workflowId: workflow.id,
      triggerType: "manual",
      idempotencyKey: `atomic-${workflow.id}`,
    },
    true
  );
  return { project, workflow, runId };
}
if (stage === "prepare" || stage === "resume") {
  let fixture;
  if (stage === "prepare")
    fixture = await create(
      `任务事务兼容_${tag}`,
      [
        node("start", "start"),
        node(
          "review",
          "operate",
          {
            nodeDh: "REVIEW",
            czmc: "兼容审批",
            instruction: "隔离兼容验收",
            assigneeMode: "user",
            assigneeUserId: actor.id,
            bdcz: { hqhqsz: "andSignFor", hqtgbfb: 100 },
          },
          250
        ),
        node("end", "end", { resultTemplate: "{{vars.review.decision}}" }, 500),
      ],
      [edge("start", "review"), edge("review", "end")]
    );
  else {
    assert(
      process.env.FLOW_ATOMIC_WORKFLOW_ID && process.env.FLOW_ATOMIC_RUN_ID
    );
    const workflow = await request("workflow.get", {
      id: process.env.FLOW_ATOMIC_WORKFLOW_ID,
    });
    assert(/^任务事务兼容_[a-f0-9]{8}$/.test(workflow.name));
    assert.equal(workflow.ownerUserId, actor.id);
    fixture = {
      workflow,
      project: { id: workflow.projectId },
      runId: process.env.FLOW_ATOMIC_RUN_ID,
    };
  }
  let complete = false;
  try {
    const waiting = await waitFor(
      fixture.runId,
      run => run.status === "waiting",
      "existing human task"
    );
    assert.equal(waiting.workflowId, fixture.workflow.id);
    assert.equal(
      read(waiting.nodeRuns.find(item => item.nodeId === "start").inputJson)
        .context.runtime.atomicHumanTaskVersion,
      undefined
    );
    if (stage === "prepare") {
      complete = true;
      console.log(
        JSON.stringify({
          stage,
          workflowId: fixture.workflow.id,
          runId: fixture.runId,
          projectId: fixture.project.id,
        })
      );
    } else {
      await request("workflow.pauseRun", { runId: fixture.runId }, true);
      assert.equal(
        (await request("workflow.resumeRun", { runId: fixture.runId }, true))
          .status,
        "waiting"
      );
      await delay(1000);
      const stillWaiting = await request("workflow.runDetail", {
        runId: fixture.runId,
      });
      assert.equal(stillWaiting.status, "waiting");
      assert(!stillWaiting.nodeRuns.some(item => item.nodeId === "end"));
      const tasks = (
        await request("task.list", {
          view: "todo",
          projectId: fixture.project.id,
        })
      ).filter(item => item.runId === fixture.runId);
      assert.equal(tasks.length, 1);
      await request(
        "task.execute",
        {
          taskId: tasks[0].id,
          result: {
            decision: "approved",
            outcome: "approved",
            comment: "旧版待办恢复验收",
          },
        },
        true
      );
      const result = await waitFor(
        fixture.runId,
        run => run.status === "success",
        "existing task completes"
      );
      assert.equal(
        read(result.nodeRuns.find(item => item.nodeId === "end").outputJson)
          .result,
        "approved"
      );
      complete = true;
      console.log(
        JSON.stringify({
          stage,
          workflowId: fixture.workflow.id,
          runId: fixture.runId,
          oldSnapshotPreserved: true,
          pauseDidNotBypassTask: true,
          status: result.status,
        })
      );
    }
  } finally {
    if (!complete)
      await request(
        "workflow.cancelRun",
        { runId: fixture.runId, reason: "旧待办事务隔离验收清理" },
        true
      ).catch(() => {});
  }
} else
  for (const kind of ["message", "timer"]) {
    const fixture = await create(
      `线性等待恢复_${kind}_${tag}`,
      [
        node("start", "start"),
        node(
          "hold",
          kind === "message" ? "message_catch" : "wait",
          kind === "message"
            ? { messageName: "atomic.root", correlationKey: tag }
            : { durationSeconds: 8 },
          250
        ),
        node(
          "after",
          "milestone",
          {
            milestoneCode: `AFTER_${kind.toUpperCase()}`,
            displayName: "等待条件满足后执行",
            category: "business",
          },
          500
        ),
        node("end", "end", { resultTemplate: "{{vars.after}}" }, 750),
      ],
      [edge("start", "hold"), edge("hold", "after"), edge("after", "end")]
    );
    console.log(
      JSON.stringify({
        stage: "created",
        kind,
        workflowId: fixture.workflow.id,
        runId: fixture.runId,
      })
    );
    let complete = false;
    try {
      const waiting = await waitFor(
        fixture.runId,
        run => run.status === "waiting",
        "root wait"
      );
      assert.equal(waiting.executionSource, "published_plan");
      const snapshot = read(
        waiting.nodeRuns.find(item => item.nodeId === "start").inputJson
      ).context.runtime;
      assert.equal(snapshot.deferredRootWaitVersion, 1);
      assert.equal(snapshot.atomicHumanTaskVersion, 1);
      assert(!waiting.nodeRuns.some(item => item.nodeId === "after"));
      await request("workflow.pauseRun", { runId: fixture.runId }, true);
      await delay(kind === "timer" ? 10000 : 1000);
      const paused = await request("workflow.runDetail", {
        runId: fixture.runId,
      });
      assert.equal(paused.status, "blocked");
      assert(!paused.nodeRuns.some(item => item.nodeId === "after"));
      assert.equal(
        (await request("workflow.resumeRun", { runId: fixture.runId }, true))
          .status,
        "waiting"
      );
      if (kind === "message") {
        await delay(1000);
        const restored = await request("workflow.runDetail", {
          runId: fixture.runId,
        });
        assert.equal(restored.status, "waiting");
        assert(!restored.nodeRuns.some(item => item.nodeId === "after"));
        await request(
          "task.signalMessage",
          {
            runId: fixture.runId,
            messageName: "atomic.root",
            correlationKey: tag,
            payload: { ready: true },
          },
          true
        );
      }
      const result = await waitFor(
        fixture.runId,
        run => run.status === "success",
        "wait releases successor"
      );
      for (const id of ["hold", "after", "end"])
        assert.equal(
          result.nodeRuns.filter(
            item => item.nodeId === id && item.status === "success"
          ).length,
          1
        );
      complete = true;
      console.log(
        JSON.stringify({
          kind,
          workflowId: fixture.workflow.id,
          runId: fixture.runId,
          pauseDidNotBypassWait: true,
          pausedTimerDidNotAdvance: kind === "timer",
          successorCount: 1,
          status: result.status,
        })
      );
    } finally {
      if (!complete)
        await request(
          "workflow.cancelRun",
          { runId: fixture.runId, reason: "线性等待隔离验收清理" },
          true
        ).catch(() => {});
    }
  }
