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
  { code: `INSTANCE_${tag}`, name: `实例状态分层测试_${tag}` },
  true
);
const createdRuns = new Set();
const scenarios = [];
const node = (id, type, name, config, x) => ({
  id,
  type,
  name,
  config,
  position: { x, y: 0 },
});
const edge = (id, sourceNodeId, targetNodeId, sourceHandle) => ({
  id,
  sourceNodeId,
  targetNodeId,
  ...(sourceHandle ? { sourceHandle } : {}),
});
try {
  for (const [flowType, outcome] of [
    ["control", "approved"],
    ["control", "rejected"],
    ["state", "approved"],
    ["state", "rejected"],
  ]) {
    const name = `状态分层测试_${flowType}_${outcome}_${tag}`;
    const nodes = [
      node("start", "start", "开始", { initialVariables: {} }, 0),
      node(
        "operate",
        "operate",
        "状态分层测试办理",
        {
          nodeDh: "INSTANCE_SCOPE",
          czmc: "测试办理",
          instruction: "独立功能测试，不涉及业务审批。",
          assigneeMode: "user",
          assigneeUserId: (await admin.request("auth.me", null)).id,
          pendingStatusName: "我的待办",
          outcomeMode: "explicit",
          outcomes: [
            { code: "approved", label: "通过", sourceHandle: "approved" },
            { code: "rejected", label: "拒绝", sourceHandle: "rejected" },
          ],
          formSchema: { fields: [] },
        },
        400
      ),
      node(
        "end",
        "end",
        "结束",
        { resultTemplate: { route: "{{nodes.operate.result.outcome}}" } },
        900
      ),
    ];
    let edges;
    if (flowType === "state") {
      nodes.push(
        node(
          "pending",
          "state",
          "业务待审核",
          {
            stateCode: "PENDING",
            displayName: "业务待审核",
            stateType: "business",
          },
          200
        )
      );
      nodes.push(
        node(
          "done",
          "state",
          "业务已归档",
          {
            stateCode: "DONE",
            displayName: "业务已归档",
            stateType: "business",
          },
          650
        )
      );
      nodes.push(
        node(
          "rejected",
          "state",
          "业务被拒绝",
          {
            stateCode: "REJECTED",
            displayName: "业务被拒绝",
            stateType: "business",
          },
          650
        )
      );
      edges = [
        edge("s-p", "start", "pending"),
        edge("p-o", "pending", "operate"),
        edge("o-d", "operate", "done", "approved"),
        edge("o-r", "operate", "rejected", "rejected"),
        edge("d-e", "done", "end"),
        edge("r-e", "rejected", "end"),
      ];
    } else {
      edges = [
        edge("s-o", "start", "operate"),
        edge("o-e", "operate", "end", "approved"),
        edge("o-r", "operate", "end", "rejected"),
      ];
    }
    const workflow = await admin.request(
      "project.createWorkflow",
      {
        projectId: project.id,
        name,
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
    await admin.request(
      "project.auditWorkflow",
      {
        projectId: project.id,
        workflowId: workflow.id,
        auditStatus: "approved",
      },
      true
    );
    await admin.request("workflow.publish", { id: workflow.id }, true);
    const started = await admin.request(
      "workflow.run",
      {
        workflowId: workflow.id,
        input: {},
        idempotencyKey: `instance-state-${flowType}-${outcome}-${tag}`,
      },
      true
    );
    createdRuns.add(started.runId);
    const task = await waitFor(
      async () =>
        (
          await admin.request("task.list", {
            view: "todo",
            projectId: project.id,
          })
        ).find(item => item.workflowId === workflow.id),
      Boolean,
      "own task"
    );
    createdRuns.add(task.runId);
    let detail = await waitFor(
      () => admin.request("workflow.runDetail", { runId: task.runId }),
      run => run.status === "waiting",
      "waiting run"
    );
    const waitingMetrics = await admin.request("workflow.runMetrics", {
      workflowId: workflow.id,
    });
    assert.equal(waitingMetrics.executingRuns, 0);
    assert.equal(waitingMetrics.waitingRuns, 1);
    let page = await admin.request("task.instancePage", {
      view: "all",
      limit: 10,
      search: name,
    });
    let listed = page.items.find(item => item.id === task.runId);
    assert(listed, "Own instance missing");
    assert.equal(listed.displayStatus, "waiting");
    assert.equal(listed.participantStatusName, "我的待办");
    assert.equal(detail.participantStatusName, "我的待办");
    assert(
      Array.isArray(listed.availableOperations) &&
        listed.availableOperations.some(
          operation => operation.taskId === task.id
        )
    );
    const expected = flowType === "state" ? "业务待审核" : null;
    assert.equal(listed.stateName, expected);
    assert.equal(detail.currentStateName, expected);
    const unpaged = await admin.request("task.instances", {
      view: "all",
      limit: 200,
    });
    assert.equal(
      unpaged.find(item => item.id === task.runId)?.stateName,
      expected
    );
    const personalFilter = await admin.request("task.instancePage", {
      view: "all",
      limit: 10,
      search: name,
      status: "我的待办",
    });
    assert.equal(
      personalFilter.items.length,
      0,
      "Personal status must not masquerade as business status"
    );
    if (flowType === "state") {
      assert.equal(listed.stateCode, "PENDING");
      assert.equal(detail.stateVersion, 1);
      const filtered = await admin.request("task.instancePage", {
        view: "all",
        limit: 10,
        search: name,
        status: expected,
      });
      assert.equal(filtered.items.length, 1);
    } else {
      assert.equal(listed.stateCode, null);
      assert.equal(detail.stateTransitions.length, 0);
    }
    await assert.rejects(() =>
      admin.request(
        "task.execute",
        {
          taskId: task.id,
          result: { decision: "invalid", outcome: "not_configured" },
        },
        true
      )
    );
    const unchanged = await admin.request("workflow.runDetail", {
      runId: task.runId,
    });
    assert.equal(unchanged.currentStateName, expected);
    assert.equal(unchanged.stateVersion, flowType === "state" ? 1 : 0);
    if (outcome === "rejected")
      await assert.rejects(
        () =>
          admin.request(
            "task.execute",
            {
              taskId: task.id,
              result: { decision: "rejected", outcome: "rejected" },
            },
            true
          ),
        /处理意见/
      );
    const complete = () =>
      admin.request(
        "task.execute",
        {
          taskId: task.id,
          result: {
            decision: outcome,
            outcome,
            comment: "隔离流程分支验收意见",
          },
        },
        true
      );
    let completed;
    if (outcome === "approved") {
      const attempts = await Promise.allSettled([complete(), complete()]);
      assert.equal(
        attempts.filter(item => item.status === "fulfilled").length,
        1,
        "Concurrent completion must advance once"
      );
      assert.equal(
        attempts.filter(item => item.status === "rejected").length,
        1
      );
      completed = attempts.find(item => item.status === "fulfilled").value;
    } else completed = await complete();
    assert.equal(completed.canViewRun, true);
    detail = await waitFor(
      () => admin.request("workflow.runDetail", { runId: task.runId }),
      run => run.status === "success",
      "finished run"
    );
    page = await admin.request("task.instancePage", {
      view: "all",
      limit: 10,
      search: name,
    });
    listed = page.items.find(item => item.id === task.runId);
    const finalExpected =
      flowType === "state"
        ? outcome === "approved"
          ? "业务已归档"
          : "业务被拒绝"
        : null;
    assert.equal(listed.stateName, finalExpected);
    assert.equal(detail.currentStateName, finalExpected);
    assert.equal(listed.participantStatusName, detail.participantStatusName);
    assert.equal(listed.displayStatus, "success");
    const finishedMetrics = await admin.request("workflow.runMetrics", {
      workflowId: workflow.id,
    });
    assert.equal(finishedMetrics.executingRuns, 0);
    assert.equal(finishedMetrics.waitingRuns, 0);
    assert.equal(listed.availableOperations.length, 0);
    const output =
      typeof detail.finalOutputJson === "string"
        ? JSON.parse(detail.finalOutputJson)
        : detail.finalOutputJson;
    assert.equal(output.result.route, outcome);
    assert(
      !(
        await admin.request("task.list", {
          view: "todo",
          projectId: project.id,
        })
      ).some(item => item.runId === task.runId)
    );
    if (flowType === "state") {
      assert.equal(
        detail.currentStateCode,
        outcome === "approved" ? "DONE" : "REJECTED"
      );
      assert(
        !detail.nodeRuns.some(
          item =>
            item.nodeId === (outcome === "approved" ? "rejected" : "done") &&
            item.status === "success"
        )
      );
    }
    assert.equal(detail.stateTransitions.length, flowType === "state" ? 2 : 0);
    assert.equal(detail.stateVersion, flowType === "state" ? 2 : 0);
    assert.equal(
      detail.nodeRuns.filter(
        node => node.nodeType === "end" && node.status === "success"
      ).length,
      1
    );
    const finishedFilter = await admin.request("task.instancePage", {
      view: "all",
      limit: 10,
      search: name,
      status: finalExpected ?? "已审核",
    });
    assert.equal(finishedFilter.items.length, flowType === "state" ? 1 : 0);
    await assert.rejects(
      admin.request(
        "task.execute",
        {
          taskId: task.id,
          result: {
            decision: outcome,
            outcome,
            comment: "隔离流程分支验收意见",
          },
        },
        true
      )
    );
    scenarios.push({
      flowType,
      outcome,
      workflowId: workflow.id,
      runId: task.runId,
      listAndDetailAgree: true,
      businessState: finalExpected,
      participantStatus: detail.participantStatusName,
      stateVersion: detail.stateVersion,
    });
  }
  console.log(JSON.stringify({ projectId: project.id, scenarios }));
} finally {
  for (const runId of createdRuns) {
    const run = await admin.request("workflow.runDetail", { runId });
    if (["queued", "running", "waiting", "blocked"].includes(run.status))
      await admin.request("workflow.cancelRun", { runId }, true);
  }
}
