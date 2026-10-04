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
const login = {
  username: `navigation_${tag}`,
  password: randomBytes(24).toString("base64url"),
};
const created = await admin.request(
  "iam.createUser",
  { ...login, name: `办理导航测试_${tag}`, role: "user" },
  true
);
const user = { id: created.userId };
const actor = new Session();
let runId;
try {
  await actor.request("auth.login", login, true);
  const project = await admin.request(
    "project.create",
    { code: `NAV_${tag}`, name: `办理导航测试_${tag}` },
    true
  );
  await admin.request(
    "project.grantMember",
    { projectId: project.id, userId: user.id, role: "operator" },
    true
  );
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
        id: "operate",
        type: "operate",
        name: "人员搜索与表单测试",
        position: { x: 300, y: 0 },
        config: {
          nodeDh: "TASKSEARCH",
          czmc: "功能测试办理",
          instruction: "测试姓名搜索与表单类型，不涉及真实业务审批。",
          assigneeMode: "user",
          assigneeUserId: user.id,
          formSchemaVersion: 1,
          formSchema: {
            fields: [
              {
                key: "reference",
                label: "测试编号",
                type: "text",
                required: true,
              },
              {
                key: "amount",
                label: "测试数量",
                type: "number",
                required: true,
                min: 0,
              },
              {
                key: "confirmed",
                label: "测试确认",
                type: "boolean",
                required: true,
              },
            ],
          },
          outcomeMode: "explicit",
          outcomes: [
            { code: "approved", label: "通过测试", sourceHandle: "approved" },
            {
              code: "rejected",
              label: "退回测试",
              sourceHandle: "rejected",
              requireComment: true,
            },
          ],
        },
      },
      {
        id: "approved_end",
        type: "end",
        name: "通过终点",
        position: { x: 600, y: 0 },
        config: {
          resultTemplate: {
            route: "{{nodes.operate.result.outcome}}",
            reference: "{{nodes.operate.result.reference}}",
            amount: "{{nodes.operate.result.amount}}",
            confirmed: "{{nodes.operate.result.confirmed}}",
          },
        },
      },
    ],
    edges: [
      { id: "s_o", sourceNodeId: "start", targetNodeId: "operate" },
      {
        id: "o_a",
        sourceNodeId: "operate",
        targetNodeId: "approved_end",
        sourceHandle: "approved",
      },
      {
        id: "o_r",
        sourceNodeId: "operate",
        targetNodeId: "approved_end",
        sourceHandle: "rejected",
      },
    ],
  };

  const workflow = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `办理导航测试_${tag}`,
      flowType: "control",
      definition,
    },
    true
  );
  await admin.request(
    "project.auditWorkflow",
    { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" },
    true
  );
  await admin.request("workflow.publish", { id: workflow.id }, true);
  const directoryInput = {
    workflowId: workflow.id,
    kind: "user",
    query: "",
    selectedIds: [String(user.id)],
    readOnly: true,
  };
  const labels = await actor.request(
    "workflow.participantDirectory",
    directoryInput
  );
  assert.equal(
    labels.selected[0].label,
    `办理导航测试_${tag}（${login.username}）`
  );
  assert.deepEqual(labels.items, []);
  await assert.rejects(
    actor.request("workflow.participantDirectory", {
      ...directoryInput,
      query: "测试",
    }),
    /只读预览不支持搜索/
  );
  await assert.rejects(
    actor.request("workflow.participantDirectory", {
      ...directoryInput,
      selectedIds: ["99999999"],
    }),
    /只能查看此流程已配置/
  );
  await assert.rejects(
    actor.request("workflow.participantDirectory", {
      ...directoryInput,
      readOnly: false,
    }),
    /无权配置/
  );
  const started = await admin.request(
    "workflow.run",
    { workflowId: workflow.id, input: {}, idempotencyKey: `navigation-${tag}` },
    true
  );
  runId = started.runId;
  const task = await waitFor(
    async () =>
      (await actor.request("task.list", { view: "todo" })).find(
        t => t.runId === runId
      ),
    Boolean,
    "own task"
  );
  await admin.request(
    "project.revokeMember",
    { projectId: project.id, userId: user.id },
    true
  );
  const detail = await actor.request("task.get", { taskId: task.id });
  await assert.rejects(
    actor.request("workflow.participantDirectory", directoryInput),
    /无权配置/
  );
  assert.equal(detail.canAct, true);
  assert.equal(detail.canViewRun, false);
  await assert.rejects(
    actor.request("workflow.runDetail", { runId }),
    /无访问权限/
  );
  const completed = await actor.request(
    "task.execute",
    {
      taskId: task.id,
      result: {
        reference: "001",
        amount: 0,
        confirmed: false,
        decision: "approved",
        outcome: "approved",
      },
    },
    true
  );
  assert.equal(completed.canViewRun, false);
  const run = await waitFor(
    () => admin.request("workflow.runDetail", { runId }),
    r => r.status === "success",
    "finished run"
  );
  await assert.rejects(
    actor.request("workflow.runDetail", { runId }),
    /无访问权限/
  );
  assert.equal(
    (await actor.request("task.get", { taskId: task.id })).status,
    "completed"
  );
  console.log(
    JSON.stringify({
      taskId: task.id,
      runId,
      taskCompleted: true,
      fullRunDenied: true,
      canViewRun: completed.canViewRun ?? "missing",
      runStatus: run.status,
    })
  );
} finally {
  if (runId) {
    const run = await admin.request("workflow.runDetail", { runId });
    if (["queued", "running", "waiting", "blocked"].includes(run.status))
      await admin.request("workflow.cancelRun", { runId }, true);
  }
  await admin.request(
    "iam.updateUserStatus",
    { userId: user.id, status: "disabled" },
    true
  );
}
