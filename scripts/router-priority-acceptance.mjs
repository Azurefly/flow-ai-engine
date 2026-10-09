import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
// Exercise only the specified deployment and isolated fixtures created here.
const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
  const json = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(
    `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(json)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body: json } : {}),
    }
  );
  const next = response.headers.getSetCookie()[0];
  if (next) cookie = next.split(";", 1)[0];
  const body = await response.json();
  if (!response.ok || body.error)
    throw new Error(body.error?.json?.message ?? `HTTP ${response.status}`);
  return superjson.deserialize(body.result.data);
}
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(
  username && password,
  "Bootstrap credentials must be supplied by server environment"
);
await request("auth.login", { username, password }, true);
const stage = process.env.FLOW_PRIORITY_STAGE ?? "prepare";
const node = (id, type, config = {}) => ({
  id,
  type,
  name: id,
  position: {
    x: { start: 0, router: 260, a: 520, b: 520, end: 780 }[id] ?? 0,
    y: id === "b" ? 320 : 160,
  },
  config,
});
const edge = (from, to, handle = "default") => ({
  id: `${from}-${to}-${handle}`,
  sourceNodeId: from,
  targetNodeId: to,
  sourceHandle: handle,
});
if (stage === "prepare") {
  const tag = randomBytes(4).toString("hex");
  const project = await request(
    "project.create",
    { code: `PRIORITY_${tag}`.toUpperCase(), name: `优先级配置验证_${tag}` },
    true
  );
  const workflow = await request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `优先级配置验证_${tag}`,
      flowType: "control",
      definition: {
        schemaVersion: 1,
        settings: {},
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          node("start", "start"),
          node("router", "router", {
            defaultRoute: "b",
            routes: [
              {
                handle: "a",
                label: "分支A",
                priority: 100,
                targetNodeId: "a",
                condition: {
                  left: "{{input.amount}}",
                  operator: "greaterThan",
                  right: 0,
                },
              },
              {
                handle: "b",
                label: "分支B",
                priority: 200,
                targetNodeId: "b",
                condition: {
                  left: "{{input.amount}}",
                  operator: "greaterThan",
                  right: 0,
                },
              },
            ],
          }),
          node("a", "transform", { mappings: { marker: "a" } }),
          node("b", "transform", { mappings: { marker: "b" } }),
          node("end", "end", { resultTemplate: "{{vars}}" }),
        ],
        edges: [
          edge("start", "router"),
          edge("router", "a", "a"),
          edge("router", "b", "b"),
          edge("a", "end"),
          edge("b", "end"),
        ],
      },
    },
    true
  );
  console.log(
    JSON.stringify({
      workflowId: workflow.id,
      editorUrl: `${base}/#/flows/workflow/${workflow.id}/editor`,
      initialPriorities: { a: 100, b: 200 },
    })
  );
} else {
  assert.equal(stage, "verify");
  const workflowId = process.env.FLOW_UI_WORKFLOW_ID;
  assert(workflowId);
  const workflow = await request("workflow.get", { id: workflowId });
  assert.match(workflow.name, /^优先级配置验证_[a-f0-9]{8}$/);
  const definition =
    typeof workflow.definition === "string"
      ? JSON.parse(workflow.definition)
      : workflow.definition;
  const routes = definition.nodes.find(n => n.id === "router").config.routes;
  const expected = process.env.FLOW_PRIORITY_EXPECT ?? "a";
  assert(["a", "b"].includes(expected));
  if (expected === "a") {
    assert.equal(Number(routes.find(r => r.handle === "a").priority), 300);
    assert.equal(
      Number(routes.find(r => r.handle === "a").routerRulePriority),
      300
    );
  }
  const started = await request(
    "workflow.run",
    {
      workflowId,
      triggerType: "test",
      input: { amount: 10 },
      idempotencyKey: `priority-${randomBytes(8).toString("hex")}`,
    },
    true
  );
  let terminal = false;
  try {
    let run;
    for (let i = 0; i < 60; i++) {
      run = await request("workflow.runDetail", { runId: started.runId });
      if (
        ["success", "failed", "cancelled", "terminated"].includes(run.status)
      ) {
        terminal = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(run.status, "success", JSON.stringify(run.errorJson));
    const output =
      typeof run.finalOutputJson === "string"
        ? JSON.parse(run.finalOutputJson)
        : run.finalOutputJson;
    assert.equal(output.result[expected]?.marker, expected);
    assert.equal(output.result[expected === "a" ? "b" : "a"], undefined);
    console.log(
      JSON.stringify({
        workflowId,
        runId: started.runId,
        status: run.status,
        selectedBranch: expected,
        savedPriority: routes.find(r => r.handle === expected).priority,
      })
    );
  } finally {
    if (!terminal)
      await request("workflow.cancelRun", { runId: started.runId }, true);
  }
}
