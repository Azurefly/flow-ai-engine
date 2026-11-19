// Creates a dedicated project, publishes two workflows, processes one human task, and archives the project.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  routerAcceptanceConfig,
  RouterAcceptanceSession,
} from "./router-acceptance-safety.mjs";

const { base, username, password } = routerAcceptanceConfig(process.env);
const session = new RouterAcceptanceSession(base);
const code = "CHILD_" + randomUUID().slice(0, 8).toUpperCase();
const report = { projectCode: code, target: base };
let project,
  parentRun,
  active = false;

function graph(steps) {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: steps.map(([id, type, config], i) => ({
      id,
      type,
      name: id,
      config,
      position: { x: i * 240, y: 0 },
    })),
    edges: steps.slice(1).map(([id], i) => ({
      id: "e" + i,
      sourceNodeId: steps[i][0],
      targetNodeId: id,
      sourceHandle: steps[i][1] === "operate" ? "approved" : "default",
    })),
  };
}
function childDefinition(actor, version) {
  return graph([
    ["start", "start", {}],
    [
      "approve",
      "operate",
      {
        nodeDh: "TEST_CHILD",
        czmc: "确认联测专用回执",
        assigneeMode: "user",
        assigneeUserId: actor.id,
        bdcz: { hqhqsz: "", hqtgbfb: 100 },
      },
    ],
    [
      "end",
      "end",
      { resultTemplate: { receipt: "{{input.receipt}}", version } },
    ],
  ]);
}
async function publish(id) {
  const draft = await session.request("workflow.get", { id });
  await session.request(
    "project.auditWorkflow",
    {
      projectId: project.id,
      workflowId: id,
      auditStatus: "approved",
      expectedAuditStatus: draft.auditStatus,
      expectedDefinitionVersion: draft.definitionVersion,
    },
    true
  );
  const approved = await session.request("workflow.get", { id });
  await session.request(
    "workflow.publish",
    { id, expectedDefinitionVersion: approved.definitionVersion },
    true
  );
  return session.request("workflow.get", { id });
}
async function waitFor(runId, expected, predicate = () => true) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const row = await session.request("workflow.runDetail", { runId });
    if (row.status === expected && predicate(row)) return row;
    if (
      ["failed", "cancelled", "terminated", "success"].includes(row.status) &&
      row.status !== expected
    )
      throw Error("实例提前结束，状态 " + row.status);
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw Error("等待实例状态超时 " + expected);
}
const mutation = (name, input) => session.request(name, input, true);
try {
  const actor = await mutation("auth.login", { username, password });
  active = true;
  project = await mutation("project.create", {
    code,
    name: "父子流程联测 " + code,
  });
  report.projectId = project.id;
  console.log(
    JSON.stringify({ stage: "project", projectId: project.id, code })
  );
  const child = await mutation("project.createWorkflow", {
    projectId: project.id,
    name: "固定版本人工审批",
    flowType: "control",
    definition: childDefinition(actor, "first"),
  });
  const first = await publish(child.id);
  const parent = await mutation("project.createWorkflow", {
    projectId: project.id,
    name: "等待同一子调用",
    flowType: "control",
    definition: graph([
      ["start", "start", {}],
      [
        "call",
        "subflow",
        {
          executionMode: "durable_child",
          subflowId: child.id,
          input: "{{input}}",
          childResultPath: "receipt",
        },
      ],
      ["end", "end", { resultTemplate: "{{nodes.call}}" }],
    ]),
  });
  await publish(parent.id);
  const ready = await mutation("workflow.runReadiness", {
    workflowId: parent.id,
    mode: "formal",
    input: { receipt: code },
  });
  assert.equal(ready.canStart, true);
  assert(ready.planHash);
  const r = await mutation("workflow.run", {
    workflowId: parent.id,
    input: { receipt: code },
    idempotencyKey: code,
    expectedDefinitionVersion: ready.definitionVersion,
    expectedExecutionPlanHash: ready.planHash,
  });
  parentRun = r.runId;
  report.parentRunId = r.runId;
  const parked = await waitFor(
    parentRun,
    "waiting",
    row => row.childLinks?.length === 1
  );
  const [link] = parked.childLinks;
  report.childRunId = link.runId;
  report.fixedVersion = link.version;
  assert.equal(link.version, first.definitionVersion);
  const pending = await waitFor(link.runId, "waiting", row =>
    row.taskActivities?.some(task => task.status === "pending")
  );
  const task = pending.taskActivities.find(item => item.status === "pending");
  const previous = await session.request("workflow.get", { id: child.id });
  await mutation("workflow.unpublish", {
    id: child.id,
    expectedDefinitionVersion: previous.definitionVersion,
  });
  const draft = await session.request("workflow.get", { id: child.id });
  await mutation("workflow.update", {
    id: child.id,
    definition: childDefinition(actor, "second"),
    expectedDefinitionVersion: draft.definitionVersion,
  });
  const second = await publish(child.id);
  assert(second.definitionVersion > link.version);
  report.newChildVersion = second.definitionVersion;
  await mutation("task.claim", { taskId: task.id });
  await mutation("task.complete", {
    taskId: task.id,
    result: { decision: "approved", comment: "合成联测通过" },
  });
  const finished = await waitFor(parentRun, "success");
  const doneChild = await waitFor(link.runId, "success");
  assert.equal(doneChild.finalOutputJson.result.version, "first");
  assert.deepEqual(finished.finalOutputJson.result, {
    result: code,
    attempt: 1,
    status: "success",
  });
  assert.equal(finished.childLinks.length, 1);
  assert.equal(finished.childLinks[0].state, "resumed");
  assert.equal(
    finished.nodeRuns.filter(n => n.nodeId === "end" && n.status === "success")
      .length,
    1
  );
  report.parentStatus = finished.status;
  report.childStatus = doneChild.status;
  report.resultMatches = true;
} finally {
  try {
    if (project?.id) {
      const preview = await session.request("project.lifecyclePreview", {
        projectId: project.id,
      });
      if (preview.code === code && Number(preview.workflowCount) <= 2) {
        if (parentRun && !report.resultMatches)
          await mutation("workflow.cancelRun", { runId: parentRun });
        await mutation("project.changeStatus", {
          projectId: project.id,
          status: "archived",
          expectedVersion: Number(preview.lifecycleVersion),
          expectedWorkflowCount: Number(preview.workflowCount),
        });
        const after = await session.request("project.lifecyclePreview", {
          projectId: project.id,
        });
        assert.equal(after.status, "archived");
        report.archived = true;
      }
    }
  } finally {
    if (active) await mutation("auth.logout", null);
    console.log(JSON.stringify(report));
  }
}
