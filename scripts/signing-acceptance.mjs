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
const createdRuns = new Set();
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
    ["handover", 100],
    ["delegation", 100],
    ["addRemove", 100],
  ]) {
    const transfer = mode === "handover" || mode === "delegation";
    const signMode = transfer ? "" : mode === "addRemove" ? "andSignFor" : mode;
    let participants = transfer
      ? [accounts[0]]
      : mode === "addRemove"
        ? [accounts[0], accounts[1]]
        : mode === "sequentialSignFor"
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
            assigneeMode: transfer ? "user" : "department",
            ...(transfer ? { assigneeUserId: accounts[0].id } : {}),
            assigneeUnitIds: [unit.id],
            includeDescendants: false,
            bdcz: {
              bdcz: [],
              bdczjs: ["acceptor"],
              hqhqsz: signMode,
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
    assert.equal(preview.totalApprovers, participants.length);
    assert.equal(
      preview.requiredApprovals,
      transfer
        ? 1
        : signMode === "orSignFor"
          ? 1
          : signMode === "andSignFor"
            ? Math.ceil((participants.length * percent) / 100)
            : participants.length
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
    const started = await admin.request(
      "workflow.run",
      {
        workflowId: workflow.id,
        input: {},
        idempotencyKey: `sign-${tag}-${label}`,
        triggerType: "test",
      },
      true
    );
    if (started.runId) createdRuns.add(started.runId);
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
    assert.equal(new Set(tasks.map(item => item.id)).size, participants.length);
    createdRuns.add(tasks[0].runId);
    if (transfer) {
      const source = tasks[0];
      await assert.rejects(
        accounts[1].session.request(
          "task.execute",
          {
            taskId: source.id,
            result: {
              decision: "approved",
              outcome: "approved",
              serial: "001",
            },
          },
          true
        )
      );
      await assert.rejects(
        accounts[0].session.request(
          "task.handover",
          { taskId: source.id, targetUserId: accounts[0].id },
          true
        ),
        /当前任务处理人/
      );
      if (mode === "delegation")
        await accounts[0].session.request(
          "task.claim",
          { taskId: source.id },
          true
        );
      await accounts[0].session.request(
        mode === "delegation" ? "task.delegate" : "task.handover",
        { taskId: source.id, targetUserId: accounts[1].id },
        true
      );
      const moved = await accounts[1].session.request("task.get", {
        taskId: source.id,
      });
      assert.equal(moved.assignedUserId, accounts[1].id);
      assert.equal(moved.responsibleUserId, accounts[1].id);
      assert.equal(
        moved.representedUserId,
        mode === "delegation" ? accounts[0].id : null
      );
      assert.equal(moved.status, "pending");
      assert.equal(moved.claimedByUserId, null);
      assert.equal(moved.canAct, true);
      await assert.rejects(
        accounts[0].session.request(
          "task.execute",
          {
            taskId: source.id,
            result: {
              decision: "approved",
              outcome: "approved",
              serial: "001",
            },
          },
          true
        )
      );
      const before = await admin.request("workflow.runDetail", {
        runId: source.runId,
      });
      assert.equal(
        before.status,
        "waiting",
        "Transfer must not advance the workflow"
      );
      await accounts[1].session.request(
        "task.execute",
        {
          taskId: source.id,
          result: { decision: "approved", outcome: "approved", serial: "001" },
        },
        true
      );
      const run = await waitFor(
        () => admin.request("workflow.runDetail", { runId: source.runId }),
        run => ["success", "failed"].includes(run.status),
        "transfer completion"
      );
      assert.equal(run.status, "success");
      assert.equal(
        run.nodeRuns.filter(item => item.nodeId === "end").length,
        1
      );
      console.log(
        JSON.stringify({
          scenario: mode,
          workflowId: workflow.id,
          runId: run.id,
          status: run.status,
          priorOwnerBlocked: true,
          endExecutions: 1,
        })
      );
      continue;
    }
    if (mode === "addRemove") {
      let detail = await accounts[0].session.request("task.get", {
        taskId: tasks[0].id,
      });
      const oldVersion = Number(detail.memberVersion);
      const added = await accounts[0].session.request(
        "task.addSigner",
        {
          taskId: tasks[0].id,
          targetUserId: accounts[2].id,
          memberVersion: oldVersion,
        },
        true
      );
      detail = await accounts[0].session.request("task.get", {
        taskId: tasks[0].id,
      });
      assert.equal(detail.approvalProgress.total, 3);
      assert.equal(detail.approvalProgress.required, 3);
      await assert.rejects(
        accounts[0].session.request(
          "task.addSigner",
          {
            taskId: tasks[0].id,
            targetUserId: accounts[2].id,
            memberVersion: Number(detail.memberVersion),
          },
          true
        ),
        /已在/
      );
      await assert.rejects(
        accounts[0].session.request(
          "task.removeSigner",
          {
            taskId: tasks[0].id,
            memberTaskId: tasks[1].id,
            memberVersion: oldVersion,
          },
          true
        ),
        /已变化/
      );
      await accounts[0].session.request(
        "task.removeSigner",
        {
          taskId: tasks[0].id,
          memberTaskId: tasks[1].id,
          memberVersion: Number(detail.memberVersion),
        },
        true
      );
      const removed = await accounts[1].session.request("task.get", {
        taskId: tasks[1].id,
      });
      assert.equal(removed.status, "cancelled");
      assert.equal(removed.canAct, false);
      await assert.rejects(
        accounts[1].session.request(
          "task.execute",
          {
            taskId: tasks[1].id,
            result: {
              decision: "approved",
              outcome: "approved",
              serial: "001",
            },
          },
          true
        )
      );
      const finalGroup = await accounts[0].session.request("task.get", {
        taskId: tasks[0].id,
      });
      assert.equal(finalGroup.approvalProgress.total, 2);
      assert.equal(finalGroup.approvalProgress.required, 2);
      tasks[1] = await accounts[2].session.request("task.get", {
        taskId: added.taskId,
      });
      participants = [accounts[0], accounts[2]];
    }
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
        : mode === "addRemove"
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
    const last = participants.length - 1;
    const remaining = await participants[last].session.request("task.get", {
      taskId: tasks[last].id,
    });
    assert.equal(
      remaining.status,
      required < participants.length ? "cancelled" : "completed"
    );
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
  for (const runId of createdRuns) {
    const run = await admin.request("workflow.runDetail", { runId });
    if (["queued", "running", "waiting"].includes(run.status)) {
      await admin.request("workflow.cancelRun", { runId }, true);
      console.log(
        JSON.stringify({ cleanup: "unfinished-test-run-cancelled", runId })
      );
    }
  }
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
