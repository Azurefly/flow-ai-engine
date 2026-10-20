import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";

// The only acceptance endpoint is the user-authorized deployment.
const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
    // Fixture writes explicitly submit the revision just inspected; callers may supply an older revision to test conflicts.

    // Fixture maintenance supplies its inspected review baseline; explicit stale baselines are preserved.
    if (["project.auditWorkflow", "project.resetWorkflowAudit"].includes(path) && input?.workflowId && input.expectedDefinitionVersion === undefined && input.expectedAuditStatus === undefined) {
      const current = await request("workflow.get", { id: input.workflowId });
      input = { ...input, expectedDefinitionVersion: Number(current.definitionVersion), expectedAuditStatus: current.auditStatus };
    }
if (["workflow.update", "workflow.publish", "workflow.unpublish"].includes(path) && input?.id && input.expectedDefinitionVersion === undefined) {
      const current = await request("workflow.get", { id: input.id });
      input = { ...input, expectedDefinitionVersion: Number(current.definitionVersion) };
    }

  const body = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(
    `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body } : {}),
      signal: AbortSignal.timeout(30000),
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
assert(
  process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME &&
    process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD
);
await request(
  "auth.login",
  {
    username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  },
  true
);
const legacy = process.env.FLOW_EXPECT_LEGACY_LOOP_VALIDATION === "1";
const tag = randomBytes(4).toString("hex");
const project = await request(
  "project.create",
  {
    code: `LOOPCHECK_${tag}`.toUpperCase(),
    name: `循环校验隔离验收_${tag}`,
  },
  true
);
const workflows = [],
  pendingRuns = new Set();

function definition(flowType, mode) {
  const node = (id, type, config = {}) => ({
    id,
    type,
    name: id,
    config,
    position: { x: 0, y: 0 },
  });
  const type = flowType === "state" ? "state" : "transform";
  const middle = id =>
    node(id, type, type === "state" ? { stateCode: id, displayName: id } : {});
  const normal = mode === "normal";
  return {
    schemaVersion: 1,
    settings: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      node("start", "start"),
      ...["a", ...(normal ? [] : ["b", "c"])].map(middle),
      node("end", "end"),
    ],
    edges: normal
      ? [
          { id: "start-a", sourceNodeId: "start", targetNodeId: "a" },
          { id: "a-end", sourceNodeId: "a", targetNodeId: "end" },
        ]
      : [
          { id: "start-a", sourceNodeId: "start", targetNodeId: "a" },
          { id: "a-b", sourceNodeId: "a", targetNodeId: "b" },
          { id: "b-c", sourceNodeId: "b", targetNodeId: "c" },
          {
            id: "c-a",
            sourceNodeId: "c",
            targetNodeId: "a",
            ...(mode === "undeclared" ? {} : { loop: { maxIterations: 2 } }),
          },
          {
            id: "c-b",
            sourceNodeId: "c",
            targetNodeId: "b",
            ...(mode === "bounded" ? { loop: { maxIterations: 3 } } : {}),
          },
          { id: "c-end", sourceNodeId: "c", targetNodeId: "end" },
        ],
  };
}

try {
  for (const flowType of ["state", "control"]) {
    const workflow = await request(
      "project.createWorkflow",
      {
        projectId: project.id,
        name: `循环校验_${flowType}_${tag}`,
        flowType,
        definition: definition(flowType, "normal"),
      },
      true
    );
    workflows.push(workflow.id);
    for (const mode of ["partial", "bounded", "undeclared", "normal"]) {
      const compiled = await request(
        "workflow.compile",
        { id: workflow.id, definition: definition(flowType, mode) },
        true
      );
      const codes = compiled.diagnostics.map(item => item.code);
      assert.equal(compiled.ok, mode === "normal");
      if (mode === "partial") {
        assert.equal(codes.includes("WF_LOOP_NOT_BOUNDED"), !legacy);
        if (!legacy)
          assert.deepEqual(
            compiled.diagnostics.find(
              item => item.code === "WF_LOOP_NOT_BOUNDED"
            ).location,
            { kind: "edge", edgeId: "b-c", field: "loop" }
          );
      } else assert(!codes.includes("WF_LOOP_NOT_BOUNDED"));
      if (["partial", "bounded"].includes(mode))
        assert(codes.includes("WF_RUNTIME_LOOP_UNSUPPORTED"));
      if (mode === "undeclared") assert(codes.includes("WF_LOOP_NOT_DECLARED"));
      console.log(
        JSON.stringify({
          flowType,
          mode,
          workflowId: workflow.id,
          codes,
          legacy,
        })
      );
    }
    await request(
      "project.auditWorkflow",
      {
        projectId: project.id,
        workflowId: workflow.id,
        auditStatus: "approved",
      },
      true
    );
    await request("workflow.publish", { id: workflow.id }, true);
    const { runId } = await request(
      "workflow.run",
      {
        workflowId: workflow.id,
        triggerType: "manual",
        input: { acceptanceTag: tag },
      },
      true
    );
    pendingRuns.add(runId);
    let completed;
    for (let attempt = 0; attempt < 60; attempt++) {
      const run = await request("workflow.runDetail", { runId });
      if (run.status === "success") {
        completed = run;
        break;
      }
      assert(
        !["failed", "cancelled", "terminated"].includes(run.status),
        JSON.stringify(run.errorJson)
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert(completed, `Timed out waiting for ${runId}`);
    assert.equal(
      completed.nodeRuns.filter(
        node => node.nodeId === "end" && node.status === "success"
      ).length,
      1
    );
    if (flowType === "state") {
      assert.equal(completed.currentStateCode, "a");
      assert.equal(completed.stateVersion, 1);
    }
    pendingRuns.delete(runId);
    console.log(
      JSON.stringify({ flowType, runId, status: "success", endExecutions: 1 })
    );
  }
} finally {
  const failures = [];
  for (const runId of pendingRuns)
    await request("workflow.cancelRun", { runId }, true).catch(error =>
      failures.push(error.message)
    );
  for (const id of workflows)
    await request("workflow.delete", { id }, true).catch(error =>
      failures.push(error.message)
    );
  assert.deepEqual(failures, [], "隔离验收流程清理失败");
  console.log(JSON.stringify({ ownWorkflowsArchived: workflows.length }));
}
