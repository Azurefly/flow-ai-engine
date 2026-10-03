// Run inside the deployed app container. All product requests use the public 1180 service.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
  const json = JSON.stringify({ json: input ?? null });
  const response = await fetch(
    `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(json)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body: json } : {}),
    }
  );
  const sessionCookie = response.headers.getSetCookie()[0];
  if (sessionCookie) cookie = sessionCookie.split(";", 1)[0];
  const payload = await response.json();
  if (!response.ok || payload.error)
    throw new Error(
      `${path}: ${payload.error?.json?.message ?? response.status}`
    );
  return payload.result.data.json;
}
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(username && password, "Missing existing bootstrap login configuration");
const user = await request("auth.login", { username, password }, true);
assert.equal(user.role, "admin");
if (process.argv[2] === "--verify") {
  const task = await request("task.get", { taskId: process.argv[3] });
  assert.equal(task.nodeName, "人员搜索与表单测试");
  assert.equal(task.status, "completed");
  const result =
    typeof task.result === "string" ? JSON.parse(task.result) : task.result;
  assert.deepEqual(result, {
    reference: "001",
    amount: 0,
    confirmed: false,
    outcome: "approved",
    decision: "approved",
  });
  const run = await request("workflow.runDetail", { runId: task.runId });
  assert.equal(run.status, "success");
  const context =
    typeof run.contextJson === "string"
      ? JSON.parse(run.contextJson)
      : run.contextJson;
  assert.deepEqual(context.nodes.approved_end.result, {
    route: "approved",
    reference: "001",
    amount: 0,
    confirmed: false,
  });
  console.log(
    JSON.stringify({
      taskId: task.id,
      taskStatus: task.status,
      runStatus: run.status,
      result,
      output: context.nodes.approved_end.result,
    })
  );
  process.exit(0);
}
const tag = randomBytes(4).toString("hex");
const project = await request(
  "project.create",
  {
    code: `TASKSEARCH_${tag}`,
    name: `任务人员搜索功能测试_${tag}`,
    description: "专用功能测试数据，保留现有业务数据。",
  },
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
const workflow = await request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `人员搜索与类型表单测试_${tag}`,
    flowType: "control",
    definition,
  },
  true
);
await request(
  "project.auditWorkflow",
  { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" },
  true
);
await request("workflow.publish", { id: workflow.id }, true);
await request(
  "workflow.run",
  {
    workflowId: workflow.id,
    input: {},
    triggerType: "test",
    idempotencyKey: `task-search-${tag}`,
  },
  true
);
let task;
for (let attempt = 0; attempt < 60; attempt++) {
  task = (
    await request("task.list", { view: "todo", projectId: project.id })
  ).find(item => item.workflowId === workflow.id);
  if (task) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert(task, "Test task did not reach the workbench");
assert.equal((await request("task.get", { taskId: task.id })).canAct, true);
assert.deepEqual(
  await request("task.assignees", { taskId: task.id, search: "" }),
  []
);
const candidates = await request("task.assignees", {
  taskId: task.id,
  search: username,
});
assert(
  candidates.some(item => item.id === user.id),
  "Existing permitted user missing from search"
);
assert(
  candidates.every(
    item => Object.keys(item).sort().join(",") === "id,name,username"
  )
);
console.log(
  JSON.stringify({
    projectId: project.id,
    workflowId: workflow.id,
    taskId: task.id,
    runId: task.runId,
    taskName: task.nodeName,
    candidateCount: candidates.length,
    status: "ready-for-browser",
  })
);
