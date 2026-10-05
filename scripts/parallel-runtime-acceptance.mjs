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
  { code: `PARTEST_${tag}`.toUpperCase(), name: `并行运行验证_${tag}` },
  true
);
for (const scenario of [
  { name: "priority", amount: 10, broadcast: false, expected: ["high"] },
  { name: "broadcast", amount: 10, broadcast: true, expected: ["high", "low"] },
  { name: "fallback", amount: 0, broadcast: true, expected: ["fallback"] },
  {
    name: "timer",
    amount: 10,
    broadcast: true,
    expected: ["high", "low"],
    timer: true,
  },
]) {
  const branches = ["high", "low", "fallback"];
  const node = (id, type, config = {}, x = 0, y = 0) => ({
    id,
    type,
    name: id,
    config,
    position: { x, y },
  });
  const definition = {
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
          lymc: "条件分流",
          broadcast: scenario.broadcast,
          parallelJoinNodeId: "join",
          defaultRoute: "fallback",
          routes: [
            {
              handle: "low",
              label: "普通路径",
              priority: 100,
              targetNodeId: "low",
              condition: {
                left: "{{input.amount}}",
                operator: "greaterThan",
                right: 0,
              },
            },
            {
              handle: "high",
              label: "优先路径",
              priority: 200,
              targetNodeId: "high",
              condition: {
                left: "{{input.amount}}",
                operator: "greaterThan",
                right: 1,
              },
            },
            {
              handle: "fallback",
              label: "默认路径",
              priority: -1,
              targetNodeId: "fallback",
            },
          ],
        },
        200
      ),
      ...branches.map((id, i) =>
        node(
          id,
          scenario.timer && id === "high" ? "wait" : "transform",
          scenario.timer && id === "high"
            ? { durationSeconds: 3 }
            : { mappings: { branch: id } },
          400,
          i * 150
        )
      ),
      node(
        "join",
        "transform",
        scenario.broadcast ? { parallelForNodeId: "router" } : {},
        600
      ),
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
        { id: `${id}-j`, sourceNodeId: id, targetNodeId: "join" },
      ]),
      { id: "j-e", sourceNodeId: "join", targetNodeId: "end" },
    ],
  };
  const fixture = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `并行验证_${scenario.name}_${tag}`,
      flowType: "control",
      definition,
    },
    true
  );
  const started = await admin.request(
    "workflow.run",
    {
      workflowId: fixture.id,
      triggerType: "test",
      input: { amount: scenario.amount },
      idempotencyKey: `parallel-${scenario.name}-${tag}`,
    },
    true
  );
  const result = await waitFor(
    () => admin.request("workflow.runDetail", { runId: started.runId }),
    value => ["success", "failed"].includes(value.status),
    scenario.name
  );
  assert.equal(result.status, "success", JSON.stringify(result.errorJson));
  const executed = result.nodeRuns.filter(
    nodeRun => nodeRun.status === "success"
  );
  assert.deepEqual(
    executed
      .filter(nodeRun => branches.includes(nodeRun.nodeId))
      .map(nodeRun => nodeRun.nodeId)
      .sort(),
    [...scenario.expected].sort()
  );
  assert.equal(executed.filter(nodeRun => nodeRun.nodeId === "join").length, 1);
  assert.equal(executed.filter(nodeRun => nodeRun.nodeId === "end").length, 1);
  console.log(
    JSON.stringify({
      projectId: project.id,
      workflowId: fixture.id,
      runId: started.runId,
      scenario: scenario.name,
      status: result.status,
    })
  );
}
