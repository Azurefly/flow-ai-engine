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
const accounts = [];
let unit;
try {
  const project = await admin.request(
    "project.create",
    { code: `SIGNTEST_${tag}`, name: `多人审批功能测试_${tag}` },
    true
  );
  unit = await admin.request(
    "config.createOrganizationUnit",
    { code: `SIGNTEST_${tag}`, name: `审批测试部门_${tag}` },
    true
  );
  for (let index = 0; index < 3; index++) {
    const login = {
      username: `sign_${tag}_${index}`,
      password: randomBytes(24).toString("base64url"),
    };
    const created = await admin.request(
      "iam.createUser",
      { ...login, name: `审批测试人员${index + 1}_${tag}`, role: "user" },
      true
    );
    const account = { id: created.userId, session: new Session() };
    accounts.push(account);
    await admin.request(
      "project.grantMember",
      { projectId: project.id, userId: account.id, role: "operator" },
      true
    );
    await admin.request(
      "config.assignOrganizationMember",
      { unitId: unit.id, userId: account.id },
      true
    );
    await account.session.request("auth.login", login, true);
  }
  for (const [mode, percent] of [
    ["orSignFor", 100],
    ["andSignFor", 100],
    ["andSignFor", 66],
    ["andSignFor", 1],
    ["sequentialSignFor", 100],
  ]) {
    const participants =
      mode === "sequentialSignFor"
        ? [accounts[2], accounts[0], accounts[1]]
        : accounts;
    const label = `${mode}_${percent}`;
    const definition = {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: [
        {
          id: "start",
          type: "start",
          name: "开始",
          position: { x: 0, y: 0 },
          config: { initialVariables: {} },
        },
        {
          id: "approve",
          type: "operate",
          name: label,
          position: { x: 250, y: 0 },
          config: {
            nodeDh: "SIGNTEST",
            czmc: "测试审批",
            instruction: "专用多人审批功能测试",
            assigneeMode: "department",
            assigneeUnitIds: [unit.id],
            includeDescendants: false,
            bdcz: {
              bdcz: [],
              bdczjs: ["acceptor"],
              hqhqsz: mode,
              xzdfhq: participants.map(item => item.id),
              hqtgbfb: percent,
            },
            formSchema: {
              fields: [
                {
                  key: "serial",
                  label: "测试编号",
                  type: "text",
                  required: true,
                  defaultValue: "001",
                },
              ],
            },
            outcomeMode: "explicit",
            outcomes: [
              { code: "approved", label: "通过", sourceHandle: "approved" },
              {
                code: "rejected",
                label: "退回",
                sourceHandle: "rejected",
                requireComment: true,
              },
            ],
          },
        },
        {
          id: "end",
          type: "end",
          name: "结束",
          position: { x: 500, y: 0 },
          config: { resultTemplate: { status: "finished" } },
        },
      ],
      edges: [
        { id: "s_a", sourceNodeId: "start", targetNodeId: "approve" },
        {
          id: "a_e",
          sourceNodeId: "approve",
          targetNodeId: "end",
          sourceHandle: "approved",
        },
        {
          id: "r_e",
          sourceNodeId: "approve",
          targetNodeId: "end",
          sourceHandle: "rejected",
        },
      ],
    };
    const workflow = await admin.request(
      "project.createWorkflow",
      {
        projectId: project.id,
        name: `${label}_${tag}`,
        flowType: "control",
        definition,
      },
      true
    );
    const preview = await admin.request(
      "workflow.previewParticipants",
      {
        workflowId: workflow.id,
        config: definition.nodes.find(node => node.id === "approve").config,
      },
      true
    );
    assert.equal(preview.totalApprovers, 3);
    assert.equal(
      preview.requiredApprovals,
      mode === "orSignFor"
        ? 1
        : mode === "andSignFor"
          ? Math.ceil((3 * percent) / 100)
          : 3
    );
    assert.deepEqual(
      preview.users.map(user => user.id),
      participants.map(account => account.id)
    );
    assert.ok(
      preview.users.every(
        user =>
          typeof user.name === "string" &&
          user.name &&
          Object.keys(user).length === 3
      )
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
    await admin.request(
      "workflow.run",
      {
        workflowId: workflow.id,
        input: {},
        idempotencyKey: `sign-${tag}-${label}`,
        triggerType: "test",
      },
      true
    );
    const tasks = [];
    for (const account of participants) {
      const items = await waitFor(
        () =>
          account.session.request("task.list", {
            view: "todo",
            projectId: project.id,
          }),
        items => items.some(item => item.workflowId === workflow.id),
        "signing tasks"
      );
      tasks.push(items.find(item => item.workflowId === workflow.id));
    }
    assert.equal(new Set(tasks.map(item => item.id)).size, 3);
    if (mode === "sequentialSignFor") {
      assert.equal(tasks[0].canAct, true);
      assert.deepEqual(
        tasks.map(task => task.approvalOrder),
        [0, 1, 2],
        "Explicit signer order must override directory order"
      );
      assert.equal(tasks[2].canAct, false);
      assert.equal(tasks[2].actionLabel, "等待前序审批");
      const waiting = await participants[2].session.request("task.get", {
        taskId: tasks[2].id,
      });
      assert.equal(waiting.canAct, false);
      assert.match(waiting.blockedReason, /前序审批人/);
      await assert.rejects(
        participants[2].session.request(
          "task.claim",
          { taskId: tasks[2].id },
          true
        ),
        /尚未轮到/
      );
    }
    const required =
      mode === "orSignFor"
        ? 2
        : mode === "andSignFor"
          ? Math.ceil((3 * percent) / 100)
          : 3;
    for (let index = 0; index < required; index++) {
      const rejected = mode === "orSignFor" && index === 0;
      if (mode === "sequentialSignFor") {
        const current = await participants[index].session.request("task.get", {
          taskId: tasks[index].id,
        });
        assert.equal(
          current.canAct,
          true,
          "Current sequential signer must become actionable"
        );
        assert.equal(current.blockedReason, null);
      }
      await participants[index].session.request(
        "task.execute",
        {
          taskId: tasks[index].id,
          result: {
            decision: rejected ? "rejected" : "approved",
            outcome: rejected ? "rejected" : "approved",
            serial: "001",
            ...(rejected ? { comment: "测试其他审批人复核" } : {}),
          },
        },
        true
      );
      if (index + 1 < required) {
        const run = await admin.request("workflow.runDetail", {
          runId: tasks[0].runId,
        });
        assert.equal(
          run.status,
          "waiting",
          "Partial approvals must not finish the run"
        );
      }
    }
    await assert.rejects(
      participants[0].session.request(
        "task.execute",
        {
          taskId: tasks[0].id,
          result: { decision: "approved", outcome: "approved", serial: "001" },
        },
        true
      )
    );
    const run = await waitFor(
      () => admin.request("workflow.runDetail", { runId: tasks[0].runId }),
      run => ["success", "failed", "cancelled"].includes(run.status),
      "run completion"
    );
    assert.equal(run.status, "success");
    assert.equal(
      run.nodeRuns.filter(item => item.nodeId === "end").length,
      1,
      "Run must advance exactly once"
    );
    const remaining = await participants[2].session.request("task.get", {
      taskId: tasks[2].id,
    });
    assert.equal(remaining.status, required < 3 ? "cancelled" : "completed");
    console.log(
      JSON.stringify({
        scenario: label,
        workflowId: workflow.id,
        runId: run.id,
        status: run.status,
        endExecutions: 1,
        repeatedSubmissionRejected: true,
        previewMatchesApprovalOrder: true,
      })
    );
  }
} finally {
  for (const account of accounts)
    await admin.request(
      "iam.updateUserStatus",
      { userId: account.id, status: "disabled" },
      true
    );
  if (unit)
    await admin.request(
      "config.updateOrganizationUnit",
      { id: unit.id, status: "disabled" },
      true
    );
  console.log(
    JSON.stringify({
      cleanup: "test-accounts-and-department-disabled",
      accounts: accounts.length,
    })
  );
}
