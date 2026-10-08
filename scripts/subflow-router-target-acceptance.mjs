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
const tag = randomBytes(4).toString("hex");
const missingTarget = process.env.FLOW_SUBROUTE_MODE === "missing-target";
const expectLegacy = process.env.FLOW_SUBROUTE_EXPECT === "legacy";
const node = (id, type, config = {}) => ({
  id,
  type,
  name: id,
  config,
  position: { x: 0, y: 0 },
});
const edge = (sourceNodeId, targetNodeId, sourceHandle = "default") => ({
  id: `${sourceNodeId}-${targetNodeId}-${sourceHandle}`,
  sourceNodeId,
  targetNodeId,
  sourceHandle,
});
const definition = (nodes, edges) => ({
  schemaVersion: 1,
  settings: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes,
  edges,
});
const child = await request(
  "workflow.createSubflow",
  {
    name: `子流程目标路由验证_${tag}`,
    flowType: "control",
    definition: definition(
      [
        node("start", "start"),
        node("router", "router", {
          defaultRoute: "fallback",
          routes: [
            {
              handle: "legacy",
              priority: 50,
              targetNodeId: missingTarget ? "missing" : "correct",
              condition: {
                left: "{{input.amount}}",
                operator: "greaterThan",
                right: 10000,
              },
            },
            {
              handle: "chosen",
              priority: 100,
              targetNodeId: missingTarget ? "missing" : "correct",
              condition: {
                left: "{{input.amount}}",
                operator: "greaterThan",
                right: 0,
              },
            },
            { handle: "fallback", priority: -1, targetNodeId: "wrong" },
          ],
        }),
        node("correct", "transform", { mappings: { marker: "correct" } }),
        node("wrong", "transform", { mappings: { marker: "wrong" } }),
        node("end", "end", { resultTemplate: "{{vars}}" }),
      ],
      [
        edge("start", "router"),
        edge("router", "correct", "legacy"),
        edge("router", "wrong", "chosen"),
        edge("router", "wrong", "fallback"),
        edge("correct", "end"),
        edge("wrong", "end"),
      ]
    ),
  },
  true
).catch(error => {
  if (missingTarget && process.env.FLOW_SUBROUTE_EXPECT === "configuration") {
    assert.match(error.message, /目标节点 missing 不存在/);
    console.log(
      JSON.stringify({ configurationRejected: true, message: error.message })
    );
    process.exit(0);
  }
  throw error;
});
assert(
  !(missingTarget && process.env.FLOW_SUBROUTE_EXPECT === "configuration"),
  "Invalid target was unexpectedly accepted"
);
const project = await request(
  "project.create",
  { code: `SUBROUTE_${tag}`.toUpperCase(), name: `子流程目标路由验证_${tag}` },
  true
);
const parent = await request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `子流程目标路由验证_${tag}`,
    flowType: "control",
    definition: definition(
      [
        node("start", "start"),
        node("child", "subflow", { subflowId: child.id, input: "{{input}}" }),
        node("end", "end", { resultTemplate: "{{vars.child.result.result}}" }),
      ],
      [edge("start", "child"), edge("child", "end")]
    ),
  },
  true
);
for (const [amount, expected] of missingTarget
  ? [[10, "failed"]]
  : [
      [10, "correct"],
      [0, "wrong"],
    ]) {
  const started = await request(
    "workflow.run",
    {
      workflowId: parent.id,
      triggerType: "test",
      input: { amount },
      idempotencyKey: `subroute-${tag}-${amount}`,
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
    assert.equal(
      run.status,
      missingTarget && !expectLegacy ? "failed" : "success",
      JSON.stringify(run.errorJson)
    );
    const output =
      typeof run.finalOutputJson === "string"
        ? JSON.parse(run.finalOutputJson)
        : run.finalOutputJson;
    if (missingTarget) {
      if (expectLegacy) assert.deepEqual(output, {});
      else assert.match(JSON.stringify(run.errorJson), /子流程未到达结束节点/);
    } else {
      assert.equal(output.result[expected]?.marker, expected);
      assert.equal(
        output.result[expected === "correct" ? "wrong" : "correct"],
        undefined
      );
    }
    console.log(
      JSON.stringify({
        workflowId: parent.id,
        subflowId: child.id,
        runId: started.runId,
        amount,
        output,
        status: run.status,
        monitorUrl: `${base}/#/runs/monitor/${parent.id}/${started.runId}`,
      })
    );
  } finally {
    if (!terminal)
      await request("workflow.cancelRun", { runId: started.runId }, true);
  }
}
