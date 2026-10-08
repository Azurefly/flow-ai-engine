import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
// Only isolated project fixtures; endpoint is disabled before any workflow runs.
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
const expected = process.env.FLOW_SUBFLOW_EXPECT ?? "fixed";
assert(["legacy", "fixed"].includes(expected));
const tag = randomBytes(4).toString("hex");
const project = await request(
  "project.create",
  { code: `SUBCTX_${tag}`.toUpperCase(), name: `子流程端点上下文验证_${tag}` },
  true
);
const endpoint = await request(
  "project.createServiceEndpoint",
  {
    projectId: project.id,
    refCode: "SUBFLOW_CONTEXT",
    name: "停用端点上下文验收",
    baseUrl: "http://124.223.198.84/",
    targetEnvironment: "test",
  },
  true
);
await request(
  "project.setServiceEndpointStatus",
  { projectId: project.id, id: endpoint.id, status: "disabled" },
  true
);
const node = (id, type, config = {}, x = 0) => ({
  id,
  type,
  name: id,
  config,
  position: { x, y: 160 },
});
const definition = nodes => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes,
  edges: nodes.slice(0, -1).map((n, i) => ({
    id: `${n.id}-${nodes[i + 1].id}`,
    sourceNodeId: n.id,
    targetNodeId: nodes[i + 1].id,
    sourceHandle: "default",
  })),
});
const results = [];
for (const type of ["http", "rest", "method"]) {
  const config =
    type === "http"
      ? { endpointRef: "SUBFLOW_CONTEXT", method: "GET", url: "/readyz" }
      : { endpointRef: "SUBFLOW_CONTEXT", restType: "GET", restApi: "/readyz" };
  const subflow = await request(
    "workflow.createSubflow",
    {
      name: `端点上下文子流程_${type}_${tag}`,
      flowType: "control",
      definition: definition([
        node("start", "start"),
        node("service", type, config, 260),
        node("end", "end", { resultTemplate: "{{vars.service}}" }, 520),
      ]),
    },
    true
  );
  const parent = await request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `子流程端点上下文_${type}_${tag}`,
      flowType: "control",
      definition: definition([
        node("start", "start"),
        node("child", "subflow", { subflowId: subflow.id }, 260),
        node("end", "end", { resultTemplate: "{{vars.child}}" }, 520),
      ]),
    },
    true
  );
  const started = await request(
    "workflow.run",
    {
      workflowId: parent.id,
      triggerType: "test",
      idempotencyKey: `subctx-${tag}-${type}`,
    },
    true
  );
  let terminal = false;
  try {
    let run;
    for (let attempt = 0; attempt < 60; attempt++) {
      run = await request("workflow.runDetail", { runId: started.runId });
      if (
        ["success", "failed", "cancelled", "terminated"].includes(run.status)
      ) {
        terminal = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(run.status, "failed", "Disabled endpoint must stop execution");
    const error = JSON.stringify(
      run.nodeRuns.find(n => n.nodeId === "child")?.errorJson ?? run.errorJson
    );
    assert.match(
      error,
      expected === "legacy"
        ? /非项目流程不能引用项目/
        : /项目 EndpointRef 不存在或已停用/
    );
    assert.equal(run.nodeRuns.filter(n => n.nodeId === "end").length, 0);
    results.push({
      type,
      workflowId: parent.id,
      runId: started.runId,
      correctProjectLookup: expected === "fixed",
      disabledEndpointBlocked: true,
    });
  } finally {
    if (!terminal)
      await request("workflow.cancelRun", { runId: started.runId }, true);
  }
}
console.log(
  JSON.stringify({
    stage: "subflow-project-context",
    expected,
    projectId: project.id,
    endpointDisabledBeforeRun: true,
    results,
  })
);
