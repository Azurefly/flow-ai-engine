// MUTATING acceptance: creates a project, publishes four workflows and starts real runs.
// Use a dedicated test environment. Fixtures are retained for inspection/manual cleanup.
// Required: FLOW_ACCEPTANCE_BASE_URL and FLOW_ACCEPTANCE_CONFIRM_WRITES=<exact origin>,
// plus FLOW_BOOTSTRAP_ADMIN_USERNAME / FLOW_BOOTSTRAP_ADMIN_PASSWORD from the environment.
// Remote targets require HTTPS; HTTP is allowed only on loopback (including SSH tunnels).
// Never prints credentials/tokens, follows redirects, or retries uncertain writes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  routerAcceptanceConfig,
  RouterAcceptanceSession,
} from "./router-acceptance-safety.mjs";

const { base, username, password } = routerAcceptanceConfig(process.env);
async function waitFor(read, accept, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out: ${label}`);
}
const admin = new RouterAcceptanceSession(base);
const tag = randomBytes(4).toString("hex");
console.log(
  JSON.stringify({
    event: "acceptance_write_scope",
    target: base,
    projectCode: `ROUTE_${tag}`.toUpperCase(),
    cleanup:
      "Fixtures are retained; manually remove only this scope after inspection. Never blindly retry uncertain writes.",
  })
);
await admin.request("auth.login", { username, password }, true);
const project = await admin.request(
  "project.create",
  { code: `ROUTE_${tag}`.toUpperCase(), name: `原版路由回显_${tag}` },
  true
);
console.log(
  JSON.stringify({
    event: "project_created",
    projectId: project.id,
    projectCode: `ROUTE_${tag}`.toUpperCase(),
  })
);
const workflow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `原版规则名称_${tag}`,
    flowType: "control",
    definition: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: [
        {
          id: "start",
          type: "start",
          name: "开始",
          config: { initialVariables: {} },
          position: { x: 0, y: 0 },
        },
        {
          id: "router",
          type: "router",
          name: "结果分流",
          config: {
            routes: [],
            defaultRoute: "end",
            lysz: [
              {
                route: {
                  routerRuleName: "默认处理路径",
                  routerRulePriority: -1,
                  routerTargetId: "end",
                },
              },
            ],
          },
          position: { x: 250, y: 0 },
        },
        {
          id: "end",
          type: "end",
          name: "完成",
          config: { resultTemplate: "{{vars}}" },
          position: { x: 500, y: 0 },
        },
      ],
      edges: [
        {
          id: "start-router",
          sourceNodeId: "start",
          targetNodeId: "router",
          sourceHandle: "default",
        },
        {
          id: "router-end",
          sourceNodeId: "router",
          targetNodeId: "end",
          sourceHandle: "end",
        },
      ],
    },
  },
  true
);
console.log(
  JSON.stringify({
    event: "workflow_created",
    scenario: "legacy",
    projectId: project.id,
    workflowId: workflow.id,
  })
);
await admin.request(
  "project.auditWorkflow",
  { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" },
  true
);
await admin.request("workflow.publish", { id: workflow.id }, true);
const started = await admin.request(
  "workflow.run",
  { workflowId: workflow.id, input: {}, idempotencyKey: `route-${tag}` },
  true
);
console.log(
  JSON.stringify({
    event: "run_started",
    scenario: "legacy",
    workflowId: workflow.id,
    runId: started.runId,
  })
);
const run = await waitFor(
  () => admin.request("workflow.runDetail", { runId: started.runId }),
  value =>
    ["success", "failed", "cancelled", "terminated"].includes(value.status),
  "legacy route"
);
assert.equal(run.status, "success");
console.log(
  JSON.stringify({
    projectId: project.id,
    workflowId: workflow.id,
    runId: started.runId,
    status: run.status,
  })
);

for (const scenario of [
  { name: "priority", broadcast: false, amount: 10, expected: ["high"] },
  { name: "broadcast", broadcast: true, amount: 10, expected: ["high", "low"] },
  { name: "fallback", broadcast: true, amount: 0, expected: ["fallback"] },
]) {
  const branches = ["high", "low", "fallback"];
  const fixture = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `路由_${scenario.name}_${tag}`,
      flowType: "control",
      definition: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        nodes: [
          {
            id: "start",
            type: "start",
            name: "开始",
            config: { initialVariables: {} },
            position: { x: 0, y: 0 },
          },
          {
            id: "router",
            type: "router",
            name: "路由",
            config: {
              broadcast: scenario.broadcast,
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
            position: { x: 250, y: 0 },
          },
          {
            id: "end",
            type: "end",
            name: "完成",
            config: { resultTemplate: "{{vars}}" },
            position: { x: 750, y: 0 },
          },
          ...branches.map((id, i) => ({
            id,
            type: "transform",
            name: id,
            config: { mappings: { branch: id } },
            position: { x: 500, y: i * 150 },
          })),
        ],
        edges: [
          {
            id: "s-r",
            sourceNodeId: "start",
            targetNodeId: "router",
            sourceHandle: "default",
          },
          ...branches.map(id => ({
            id: `${id}-end`,
            sourceNodeId: id,
            targetNodeId: "end",
            sourceHandle: "default",
          })),
          ...branches.map(id => ({
            id: `r-${id}`,
            sourceNodeId: "router",
            targetNodeId: id,
            sourceHandle: id,
          })),
        ],
      },
    },
    true
  );
  console.log(
    JSON.stringify({
      event: "workflow_created",
      scenario: scenario.name,
      projectId: project.id,
      workflowId: fixture.id,
    })
  );
  await admin.request(
    "project.auditWorkflow",
    { projectId: project.id, workflowId: fixture.id, auditStatus: "approved" },
    true
  );
  await admin.request("workflow.publish", { id: fixture.id }, true);
  const execution = await admin.request(
    "workflow.run",
    {
      workflowId: fixture.id,
      input: { amount: scenario.amount },
      idempotencyKey: `route-${scenario.name}-${tag}`,
    },
    true
  );
  console.log(
    JSON.stringify({
      event: "run_started",
      scenario: scenario.name,
      workflowId: fixture.id,
      runId: execution.runId,
    })
  );
  const result = await waitFor(
    () => admin.request("workflow.runDetail", { runId: execution.runId }),
    value =>
      ["success", "failed", "cancelled", "terminated"].includes(value.status),
    scenario.name
  );
  assert.equal(result.status, "success");
  assert.deepEqual(
    result.nodeRuns
      .filter(n => branches.includes(n.nodeId) && n.status === "success")
      .map(n => n.nodeId)
      .sort(),
    [...scenario.expected].sort()
  );
  console.log(
    JSON.stringify({
      scenario: scenario.name,
      workflowId: fixture.id,
      runId: execution.runId,
      executedBranches: scenario.expected,
    })
  );
}
