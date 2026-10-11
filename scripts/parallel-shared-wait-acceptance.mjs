import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";

const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
  const body = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(
    `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body } : {}),
    }
  );
  const nextCookie = response.headers.getSetCookie()[0];
  if (nextCookie) cookie = nextCookie.split(";", 1)[0];
  const payload = await response.json();
  if (!response.ok || payload.error)
    throw new Error(
      `${path}: ${payload.error?.json?.message ?? response.status}`
    );
  return superjson.deserialize(payload.result.data);
}
async function waitFor(runId, accept, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const run = await request("workflow.runDetail", { runId });
    if (accept(run)) return run;
    assert(
      !["failed", "cancelled", "terminated"].includes(run.status),
      `${label}: ${JSON.stringify(run.errorJson)}`
    );
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out: ${label}`);
}
const read = value => (typeof value === "string" ? JSON.parse(value) : value);
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(username && password, "Missing existing login configuration");
await request("auth.login", { username, password }, true);
const tag = randomBytes(4).toString("hex");
const project = await request(
  "project.create",
  { code: `SHWAIT_${tag}`.toUpperCase(), name: `共享等待验证_${tag}` },
  true
);
const node = (id, type, config = {}, x = 0, y = 0) => ({
  id,
  type,
  name: id,
  config,
  position: { x, y },
});
const edge = (sourceNodeId, targetNodeId, sourceHandle) => ({
  id: `${sourceNodeId}-${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
  ...(sourceHandle ? { sourceHandle } : {}),
});
for (const flowType of ["control", "state"]) {
  const nodes = [
    node("start", "start"),
    node(
      "router",
      "router",
      {
        nodeDh: "R1",
        lymc: "并行等待",
        gbms: true,
        parallelJoinNodeId: "join",
        defaultRoute: "a",
        routes: ["a", "b"].map(target => ({
          handle: target,
          label: target,
          targetNodeId: target,
          conditions: [],
        })),
      },
      250
    ),
    node("a", "transform", { mappings: { marker: "A" } }, 500, -100),
    node("b", "transform", { mappings: { marker: "B" } }, 500, 100),
    node(
      "shared",
      "message_catch",
      {
        messageName: "shared.ready",
        correlationKey: "{{runtime.parallelActiveTokens.0.branchId}}",
      },
      750
    ),
    node(
      "dispatch",
      "router",
      {
        nodeDh: "R2",
        lymc: "按消息结果继续",
        defaultRoute: "b",
        routes: ["a", "b"].map(branch => ({
          handle: branch,
          label: branch,
          targetNodeId: `${branch}Done`,
          conditions: [
            {
              left: "{{vars.shared.payload.value}}",
              operator: "equals",
              right: branch.toUpperCase(),
            },
          ],
        })),
      },
      1000
    ),
    node(
      "aDone",
      "transform",
      {
        mappings: {
          value: "{{vars.shared.payload.value}}",
          otherSeen: "{{vars.b.marker}}",
        },
      },
      1250,
      -100
    ),
    node(
      "bDone",
      "transform",
      {
        mappings: {
          value: "{{vars.shared.payload.value}}",
          otherSeen: "{{vars.a.marker}}",
        },
      },
      1250,
      100
    ),
    node(
      "join",
      "transform",
      {
        parallelForNodeId: "router",
        mappings: { a: "{{vars.aDone.value}}", b: "{{vars.bDone.value}}" },
      },
      1500
    ),
    node("end", "end", { resultTemplate: "{{vars.join}}" }, 2000),
  ];
  const edges = [
    edge("start", "router"),
    edge("router", "a", "a"),
    edge("router", "b", "b"),
    edge("a", "shared"),
    edge("b", "shared"),
    edge("shared", "dispatch"),
    edge("dispatch", "aDone", "a"),
    edge("dispatch", "bDone", "b"),
    edge("aDone", "join"),
    edge("bDone", "join"),
    edge("join", "end"),
  ];
  if (flowType === "state") {
    nodes.push(
      node(
        "pending",
        "state",
        {
          stateCode: "PENDING",
          displayName: "待共享消息",
          stateType: "business",
        },
        120
      )
    );
    nodes.push(
      node(
        "done",
        "state",
        {
          stateCode: "DONE",
          displayName: "共享消息处理完成",
          stateType: "business",
        },
        1750
      )
    );
    edges.find(item => item.sourceNodeId === "start").targetNodeId = "pending";
    edges.push(edge("pending", "router"));
    edges.find(item => item.sourceNodeId === "join").targetNodeId = "done";
    edges.push(edge("done", "end"));
  }
  const workflow = await request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `共享等待_${flowType}_${tag}`,
      flowType,
      definition: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        nodes,
        edges,
      },
    },
    true
  );
  await request(
    "project.auditWorkflow",
    { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" },
    true
  );
  await request("workflow.publish", { id: workflow.id }, true);
  const { runId } = await request(
    "workflow.run",
    {
      workflowId: workflow.id,
      triggerType: "manual",
      idempotencyKey: `shared-${flowType}-${tag}`,
    },
    true
  );
  console.log(
    JSON.stringify({
      stage: "created",
      projectId: project.id,
      workflowId: workflow.id,
      runId,
      flowType,
    })
  );
  let completed = false;
  try {
    const waiting = await waitFor(
      runId,
      run =>
        run.status === "waiting" &&
        run.nodeRuns.filter(
          item => item.nodeId === "shared" && item.status === "waiting"
        ).length === 2,
      "two subscriptions for one node"
    );
    assert.equal(waiting.executionSource, "published_plan");
    assert.equal(
      read(waiting.nodeRuns.find(item => item.nodeId === "start").inputJson)
        .context.runtime.durableWaitVersion,
      1
    );
    const shared = waiting.nodeRuns.filter(item => item.nodeId === "shared");
    assert.equal(new Set(shared.map(item => item.id)).size, 2);
    for (const item of shared) {
      const vars = read(item.inputJson).context.vars;
      assert(
        Boolean(vars.a) !== Boolean(vars.b),
        "Shared wait must retain separate branch data"
      );
    }
    const signal = (key, value) =>
      request(
        "task.signalMessage",
        {
          runId,
          messageName: "shared.ready",
          correlationKey: key,
          payload: { value },
        },
        true
      );
    // The configured correlation template resolves the dispatch handle/target
    // pair; runtime token paths are intentionally redacted in node-run logs.
    const aKey = JSON.stringify(["a", "a"]);
    const bKey = JSON.stringify(["b", "b"]);
    await signal(aKey, "A");
    await assert.rejects(() => signal(aKey, "A"), /订阅|等待/);
    const partial = await waitFor(
      runId,
      run =>
        run.status === "waiting" &&
        run.nodeRuns.some(
          item => item.nodeId === "aDone" && item.status === "success"
        ),
      "one shared branch resumed"
    );
    assert.equal(
      partial.nodeRuns.filter(
        item => item.nodeId === "shared" && item.status === "waiting"
      ).length,
      1
    );
    assert(!partial.nodeRuns.some(item => item.nodeId === "join"));
    await signal(bKey, "B");
    const result = await waitFor(
      runId,
      run => run.status === "success",
      "shared wait join"
    );
    const outputs = id =>
      result.nodeRuns
        .filter(item => item.nodeId === id && item.status === "success")
        .map(item => read(item.outputJson));
    assert.equal(outputs("shared").length, 2);
    assert.deepEqual(outputs("aDone"), [{ value: "A" }]);
    assert.deepEqual(outputs("bDone"), [{ value: "B" }]);
    assert.deepEqual(outputs("join"), [{ a: "A", b: "B" }]);
    assert.deepEqual(outputs("end")[0].result, { a: "A", b: "B" });
    assert.equal(outputs("end").length, 1);
    if (flowType === "state") {
      assert.equal(result.currentStateCode, "DONE");
      assert.equal(result.stateVersion, 2);
    }
    completed = true;
    console.log(
      JSON.stringify({
        projectId: project.id,
        workflowId: workflow.id,
        runId,
        flowType,
        publishedPlan: true,
        sharedWaits: 2,
        branchIsolation: true,
        duplicateDenied: true,
        joinCount: 1,
        status: result.status,
      })
    );
  } finally {
    if (!completed)
      await request(
        "workflow.cancelRun",
        { runId, reason: "共享等待隔离验收清理" },
        true
      ).catch(() => {});
  }
}
