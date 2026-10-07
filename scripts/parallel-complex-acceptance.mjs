// Public-service regression in isolated projects; no direct SQL, secrets, or existing task changes.
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
const node = (id, type = "transform", config = {}, x = 0, y = 0) => ({
  id,
  type,
  name: id,
  config,
  position: { x, y },
});
const edge = (sourceNodeId, targetNodeId, sourceHandle) => ({
  id: `${sourceNodeId}-${targetNodeId}-${sourceHandle || "default"}`,
  sourceNodeId,
  targetNodeId,
  ...(sourceHandle ? { sourceHandle } : {}),
});
const router = (id, join, targets) =>
  node(id, "router", {
    nodeDh: id,
    lymc: id,
    gbms: true,
    parallelJoinNodeId: join,
    defaultRoute: targets[0],
    routes: targets.map((target, i) => ({
      handle: target,
      label: target,
      targetNodeId: target,
      priority: 100 - i,
      conditions: [],
    })),
  });
const decode = value => (typeof value === "string" ? JSON.parse(value) : value);
for (const { scenario, flowType } of ["control", "state"].flatMap(flowType =>
  ["nested-timer", "shared-node"].map(scenario => ({ scenario, flowType }))
)) {
  const nested = scenario === "nested-timer";
  const nodes = nested
    ? [
        node("start", "start"),
        router("outer", "outerJoin", ["inner", "b"]),
        router("inner", "innerJoin", ["wait", "y"]),
        node("wait", "wait", { durationSeconds: 3 }),
        node("xa", "transform", { mappings: { value: "X" } }),
        node("y", "transform", {
          mappings: { value: "Y", xaSeen: "{{vars.xa.value}}" },
        }),
        node("b", "transform", {
          mappings: { value: "B", xaSeen: "{{vars.xa.value}}" },
        }),
        node("innerJoin", "transform", {
          parallelForNodeId: "inner",
          mappings: { x: "{{vars.xa.value}}", y: "{{vars.y.value}}" },
        }),
        node("outerJoin", "transform", {
          parallelForNodeId: "outer",
          mappings: { inner: "{{vars.innerJoin}}", b: "{{vars.b.value}}" },
        }),
        node("end", "end", { resultTemplate: "{{vars}}" }),
      ]
    : [
        node("start", "start"),
        router("outer", "outerJoin", ["a", "b", "c"]),
        node("a", "transform", { mappings: { value: "A" } }),
        node("b", "transform", { mappings: { value: "B" } }),
        node("c", "transform", { mappings: { value: "C" } }),
        node("shared", "transform", {
          mappings: { aSeen: "{{vars.a.value}}", bSeen: "{{vars.b.value}}" },
        }),
        node("outerJoin", "transform", {
          parallelForNodeId: "outer",
          mappings: { shared: "{{vars.shared}}", c: "{{vars.c.value}}" },
        }),
        node("end", "end", { resultTemplate: "{{vars}}" }),
      ];
  const edges = nested
    ? [
        edge("start", "outer"),
        edge("outer", "inner", "inner"),
        edge("outer", "b", "b"),
        edge("inner", "wait", "wait"),
        edge("inner", "y", "y"),
        edge("wait", "xa"),
        edge("xa", "innerJoin"),
        edge("y", "innerJoin"),
        edge("innerJoin", "outerJoin"),
        edge("b", "outerJoin"),
        edge("outerJoin", "end"),
      ]
    : [
        edge("start", "outer"),
        edge("outer", "a", "a"),
        edge("outer", "b", "b"),
        edge("outer", "c", "c"),
        edge("a", "shared"),
        edge("b", "shared"),
        edge("shared", "outerJoin"),
        edge("c", "outerJoin"),
        edge("outerJoin", "end"),
      ];
  if (flowType === "state") {
    nodes.push(
      node("pending", "state", {
        stateCode: "PENDING",
        displayName: "并行处理前",
        stateType: "business",
      })
    );
    nodes.push(
      node("done", "state", {
        stateCode: "DONE",
        displayName: "并行处理完成",
        stateType: "business",
      })
    );
    edges.find(e => e.sourceNodeId === "start").targetNodeId = "pending";
    edges.push(edge("pending", "outer"));
    edges.find(e => e.sourceNodeId === "outerJoin").targetNodeId = "done";
    edges.push(edge("done", "end"));
  }
  const levels = new Map([["start", 0]]);
  for (let pass = 0; pass < nodes.length; pass++)
    for (const link of edges)
      if (levels.has(link.sourceNodeId))
        levels.set(
          link.targetNodeId,
          Math.max(
            levels.get(link.targetNodeId) ?? 0,
            levels.get(link.sourceNodeId) + 1
          )
        );
  const rows = new Map();
  for (const item of nodes) {
    const level = levels.get(item.id) ?? 0;
    const row = rows.get(level) ?? 0;
    item.position = { x: level * 260, y: row * 180 };
    rows.set(level, row + 1);
  }
  const fixture = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `复杂并行_${flowType}_${scenario}_${tag}`,
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
  const started = await admin.request(
    "workflow.run",
    {
      workflowId: fixture.id,
      triggerType: "test",
      idempotencyKey: `complex-${flowType}-${scenario}-${tag}`,
    },
    true
  );
  let succeeded = false;
  try {
    const result = await waitFor(
      () => admin.request("workflow.runDetail", { runId: started.runId }),
      r => ["success", "failed"].includes(r.status),
      scenario
    );
    assert.equal(result.status, "success", JSON.stringify(result.errorJson));
    if (flowType === "state") {
      assert.equal(result.currentStateCode, "DONE");
      assert.equal(
        result.stateVersion,
        2,
        "Only the two state transitions may increment state version"
      );
      assert.equal(
        result.nodeRuns.filter(
          n => n.nodeId === "pending" && n.status === "success"
        ).length,
        1
      );
      assert.equal(
        result.nodeRuns.filter(
          n => n.nodeId === "done" && n.status === "success"
        ).length,
        1
      );
    }
    const executed = result.nodeRuns.filter(n => n.status === "success");
    const outputs = id =>
      executed.filter(n => n.nodeId === id).map(n => decode(n.outputJson));
    assert.equal(outputs("outerJoin").length, 1);
    assert.equal(outputs("end").length, 1);
    const final = outputs("end")[0].result;
    if (nested) {
      assert.equal(outputs("innerJoin").length, 1);
      assert.deepEqual(outputs("innerJoin")[0], { x: "X", y: "Y" });
      assert.deepEqual(outputs("outerJoin")[0], {
        inner: { x: "X", y: "Y" },
        b: "B",
      });
      assert.deepEqual(outputs("y")[0], { value: "Y" });
      assert.deepEqual(outputs("b")[0], { value: "B" });
      assert.deepEqual(final.xa, { value: "X" });
      assert.deepEqual(final.y, { value: "Y" });
      assert.deepEqual(final.b, { value: "B" });
    } else {
      assert.equal(outputs("shared").length, 2);
      assert.deepEqual(
        outputs("shared").sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b))
        ),
        [{ aSeen: "A" }, { bSeen: "B" }]
      );
      assert.deepEqual(outputs("outerJoin")[0], {
        shared: [{ aSeen: "A" }, { bSeen: "B" }],
        c: "C",
      });
      assert.deepEqual(final.shared, [{ aSeen: "A" }, { bSeen: "B" }]);
      assert.deepEqual(final.c, { value: "C" });
    }
    succeeded = true;
    console.log(
      JSON.stringify({
        projectId: project.id,
        workflowId: fixture.id,
        runId: started.runId,
        scenario,
        flowType,
        status: result.status,
        outerJoinCount: 1,
      })
    );
  } finally {
    if (!succeeded) {
      console.log(
        JSON.stringify({
          projectId: project.id,
          workflowId: fixture.id,
          runId: started.runId,
          scenario,
          flowType,
          status: "acceptance-failed",
        })
      );
      await admin
        .request("workflow.cancelRun", { runId: started.runId }, true)
        .catch(() => {});
    }
  }
}
