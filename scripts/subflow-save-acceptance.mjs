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
const stage = process.env.FLOW_SUBFLOW_STAGE ?? "prepare";
assert(["prepare", "verify"].includes(stage));
const node = (id, type, config = {}, x = 0) => ({
  id,
  type,
  name: id,
  config,
  position: { x, y: 160 },
});
const edge = (sourceNodeId, targetNodeId) => ({
  id: `${sourceNodeId}-${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
  sourceHandle: "default",
});
const definition = nodes => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes,
  edges: nodes.slice(0, -1).map((n, i) => edge(n.id, nodes[i + 1].id)),
});
if (stage === "prepare") {
  const tag = randomBytes(4).toString("hex");
  const project = await request(
    "project.create",
    { code: `SUBSAVE_${tag}`.toUpperCase(), name: `子流程保存验证_${tag}` },
    true
  );
  const workflow = await request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `子流程保存验证_${tag}`,
      flowType: "control",
      definition: definition([
        node("start", "start"),
        node(
          "map",
          "transform",
          { mappings: { echo: "{{input.businessKey}}" } },
          260
        ),
        node("end", "end", { resultTemplate: "{{vars.map}}" }, 520),
      ]),
    },
    true
  );
  console.log(
    JSON.stringify({
      stage,
      workflowId: workflow.id,
      subflowName: `私有子流程保存验证_${tag}`,
      editorUrl: `${base}/#/flows/workflow/${workflow.id}/editor`,
    })
  );
} else {
  const workflowId = process.env.FLOW_UI_WORKFLOW_ID;
  assert(workflowId, "Provide the exact isolated workflow ID from prepare");
  const source = await request("workflow.get", { id: workflowId });
  const match = /^子流程保存验证_([a-f0-9]{8})$/.exec(source.name);
  assert(match, "Only isolated prepared workflow may be verified");
  const tag = match[1];
  const subflow = (await request("workflow.subflows")).find(
    s => s.name === `私有子流程保存验证_${tag}`
  );
  assert(
    subflow,
    "Save the prepared definition in the browser before verification"
  );
  assert.equal(subflow.isEnabled, 1);
  const child =
    typeof subflow.definition === "string"
      ? JSON.parse(subflow.definition)
      : subflow.definition;
  assert.deepEqual(child.nodes.map(n => n.type).sort(), [
    "end",
    "start",
    "transform",
  ]);
  assert.deepEqual(
    child.edges.map(e => `${e.sourceNodeId}->${e.targetNodeId}`).sort(),
    ["map->end", "start->map"]
  );
  assert.deepEqual(child.nodes.find(n => n.id === "map").config.mappings, {
    echo: "{{input.businessKey}}",
  });
  assert.equal(child.settings.subflowFlowType, "control");
  await request(
    "workflow.updateSubflow",
    {
      id: subflow.id,
      definition: {
        ...child,
        settings: { ...child.settings, subflowFlowType: "state" },
      },
    },
    true
  );
  const updated = (await request("workflow.subflows")).find(
    s => s.id === subflow.id
  );
  assert.equal(
    updated.definition.settings.subflowFlowType,
    "control",
    "Definition editing must preserve saved flow type"
  );
  await assert.rejects(
    request(
      "workflow.createSubflow",
      { name: `数据子流程拒绝_${tag}`, flowType: "data", definition: child },
      true
    )
  );
  const parent = await request(
    "project.createWorkflow",
    {
      projectId: source.projectId,
      name: `子流程调用验证_${tag}`,
      flowType: "control",
      definition: definition([
        node("start", "start"),
        node(
          "child",
          "subflow",
          { subflowId: subflow.id, input: "{{input}}" },
          260
        ),
        node(
          "end",
          "end",
          { resultTemplate: "{{vars.child.result.result}}" },
          520
        ),
      ]),
    },
    true
  );
  const started = await request(
    "workflow.run",
    {
      workflowId: parent.id,
      triggerType: "test",
      input: { businessKey: "00123" },
      idempotencyKey: `subflow-save-${tag}`,
    },
    true
  );
  let finished = false;
  try {
    let run;
    for (let attempt = 0; attempt < 60; attempt++) {
      run = await request("workflow.runDetail", { runId: started.runId });
      if (["success", "failed", "cancelled", "terminated"].includes(run.status))
        break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(run.status, "success", JSON.stringify(run.errorJson));
    const output =
      typeof run.finalOutputJson === "string"
        ? JSON.parse(run.finalOutputJson)
        : run.finalOutputJson;
    assert.deepEqual(output, { result: { echo: "00123" } });
    assert.deepEqual(
      run.nodeRuns.map(n => n.nodeType),
      ["start", "subflow", "end"]
    );
    finished = true;
    console.log(
      JSON.stringify({
        stage,
        workflowId,
        subflowId: subflow.id,
        parentWorkflowId: parent.id,
        runId: started.runId,
        status: run.status,
        output,
        browserSaveAndRuntimeVerified: true,
      })
    );
  } finally {
    if (!finished)
      await request("workflow.cancelRun", { runId: started.runId }, true);
  }
}
