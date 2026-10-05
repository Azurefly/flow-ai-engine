// Public-service regression in an isolated project; no direct SQL, token printing, or existing task changes.
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
  { code: `PARTEST_${tag}`.toUpperCase(), name: `并行运行验证_${tag}` },
  true
);
const actor = await admin.request("auth.me", null);
const node = (id, type, config = {}, x = 0, y = 0) => ({
  id,
  type,
  name: id,
  config,
  position: { x, y },
});
const branches = ["a", "b"];
const fixture = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `并行人工并发_${tag}`,
    flowType: "control",
    definition: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: [
        node("start", "start"),
        node(
          "router",
          "router",
          {
            nodeDh: `R${tag}`,
            lymc: "并行审核",
            broadcast: true,
            parallelJoinNodeId: "join",
            defaultRoute: "b",
            routes: branches.map((id, i) => ({
              handle: id,
              label: id,
              targetNodeId: id,
              priority: 100 - i,
              conditions: [],
            })),
          },
          200
        ),
        ...branches.map((id, i) =>
          node(
            id,
            "operate",
            {
              nodeDh: `APPROVE${id.toUpperCase()}`,
              czmc: `审核${id}`,
              instruction: "隔离测试项目功能验证",
              assigneeMode: "user",
              assigneeUserId: actor.id,
              outcomeMode: "explicit",
              outcomes: [
                { code: "approved", label: "同意", sourceHandle: "approved" },
                { code: "rejected", label: "拒绝", sourceHandle: "rejected" },
              ],
              formSchema: { fields: [] },
            },
            400,
            i * 150
          )
        ),
        node("join", "transform", { parallelForNodeId: "router" }, 600),
        node("end", "end", { resultTemplate: "{{vars}}" }, 800),
      ],
      edges: [
        { id: "s-r", sourceNodeId: "start", targetNodeId: "router" },
        ...branches.flatMap(id => [
          {
            id: `r-${id}`,
            sourceNodeId: "router",
            targetNodeId: id,
            sourceHandle: id,
          },
          ...["approved", "rejected"].map(outcome => ({
            id: `${id}-${outcome}`,
            sourceNodeId: id,
            targetNodeId: "join",
            sourceHandle: outcome,
          })),
        ]),
        { id: "j-e", sourceNodeId: "join", targetNodeId: "end" },
      ],
    },
  },
  true
);
const started = await admin.request(
  "workflow.run",
  {
    workflowId: fixture.id,
    triggerType: "test",
    idempotencyKey: `human-${tag}`,
  },
  true
);
let succeeded = false;
try {
  await waitFor(
    () => admin.request("workflow.runDetail", { runId: started.runId }),
    run => run.status === "waiting",
    "both human tasks"
  );
  const tasks = (
    await admin.request("task.list", { view: "todo", projectId: project.id })
  ).filter(task => task.runId === started.runId);
  assert.equal(tasks.length, 2, "Both parallel tasks must be visible");
  const attempts = await Promise.allSettled(
    tasks.map(task =>
      admin.request(
        "task.execute",
        {
          taskId: task.id,
          result: {
            decision: "approved",
            outcome: "approved",
            comment: "并行任务真实并发验证",
          },
        },
        true
      )
    )
  );
  console.log(
    JSON.stringify({
      projectId: project.id,
      workflowId: fixture.id,
      runId: started.runId,
      attempts: attempts.map(item =>
        item.status === "fulfilled"
          ? { status: item.status }
          : { status: item.status, error: item.reason.message }
      ),
    })
  );
  assert.equal(
    attempts.filter(item => item.status === "fulfilled").length,
    2,
    "Both decisions must be accepted"
  );
  const result = await waitFor(
    () => admin.request("workflow.runDetail", { runId: started.runId }),
    run => ["success", "failed"].includes(run.status),
    "parallel human join"
  );
  assert.equal(result.status, "success", JSON.stringify(result.errorJson));
  assert.equal(
    result.nodeRuns.filter(
      nodeRun => nodeRun.nodeId === "join" && nodeRun.status === "success"
    ).length,
    1
  );
  assert.equal(
    result.nodeRuns.filter(
      nodeRun => nodeRun.nodeId === "end" && nodeRun.status === "success"
    ).length,
    1
  );
  succeeded = true;
  console.log(
    JSON.stringify({
      runId: started.runId,
      status: "success",
      concurrentHumanTasks: 2,
    })
  );
} finally {
  if (!succeeded)
    await admin.request("workflow.cancelRun", { runId: started.runId }, true);
}
