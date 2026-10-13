import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const body = JSON.stringify(superjson.serialize(input ?? null));
    const response = await fetch(`${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`, { method: mutation ? "POST" : "GET", headers: { "content-type": "application/json", cookie: this.cookie }, ...(mutation ? { body } : {}), signal: AbortSignal.timeout(30000) });
    const next = response.headers.getSetCookie()[0]; if (next) this.cookie = next.split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(`${path}: ${payload.error?.json?.message ?? response.status}`);
    return superjson.deserialize(payload.result.data);
  }
}
const root = new Session(), own = new Session();
const tag = "looprun_" + randomBytes(6).toString("hex"), password = "Test9_" + randomBytes(24).toString("base64url");
let account, project; const workflows = [], runs = [];
const node = (id, type, config = {}) => ({ id, type, name: id, config, position: { x: 0, y: 0 } });
const edge = (id, sourceNodeId, targetNodeId, sourceHandle, limit) => ({ id, sourceNodeId, targetNodeId, ...(sourceHandle ? { sourceHandle } : {}), ...(limit ? { loop: { maxIterations: limit } } : {}) });
const route = (id, loopEdge, count) => node(id, "router", { defaultRoute: "done", routes: [{ handle: "retry", condition: { left: `{{runtime.loopIterations.${loopEdge}}}`, operator: "lessThan", right: count } }] });
const definition = (nodes, edges) => ({ schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes, edges });
async function create(label, type, def) {
  const created = await own.request("project.createWorkflow", { projectId: project.id, name: label + "_" + tag, flowType: type, definition: def }, true);
  workflows.push({ id: created.id, name: label + "_" + tag });
  await root.request("project.auditWorkflow", { projectId: project.id, workflowId: created.id, auditStatus: "approved" }, true);
  await own.request("workflow.publish", { id: created.id }, true);
  const started = await own.request("workflow.run", { workflowId: created.id, triggerType: "manual", idempotencyKey: tag + "_" + workflows.length }, true);
  runs.push({ id: started.runId, workflowId: created.id });
  return started.runId;
}
async function settle(runId, status = "success") {
  for (let i = 0; i < 80; i++) {
    const run = await own.request("workflow.runDetail", { runId });
    if (run.status === status) return run;
    assert(!["failed", "cancelled", "terminated"].includes(run.status), JSON.stringify(run.errorJson));
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`未完成运行 ${runId}`);
}
try {
  await root.request("auth.login", { username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME, password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD }, true);
  account = await root.request("iam.createUser", { username: tag, password, name: "循环隔离验收_" + tag, role: "admin" }, true);
  await own.request("auth.login", { username: tag, password }, true);
  project = await own.request("project.create", { code: tag.toUpperCase(), name: "循环隔离验收_" + tag }, true);
  for (const flowType of ["control", "state"]) {
    const middle = flowType === "state" ? node("body", "state", { stateCode: "BODY", displayName: "处理中", stateType: "business" }) : node("body", "milestone", { milestoneCode: "CHECK", displayName: "迭代检查" });
    const terminal = flowType === "state" ? [node("doneState", "state", { stateCode: "DONE", displayName: "已完成", stateType: "terminal" })] : [];
    const runId = await create("同步返回_" + flowType, flowType, definition([node("start", "start"), middle, route("route", "back", 2), ...terminal, node("end", "end")], [edge("initial", "start", "body"), edge("forward", "body", "route"), edge("back", "route", "body", "retry", 3), edge("finish", "route", flowType === "state" ? "doneState" : "end", "done"), ...(flowType === "state" ? [edge("terminal", "doneState", "end")] : [])]));
    const run = await settle(runId);
    assert.equal(run.nodeRuns.filter(row => row.nodeId === "body" && row.status === "success").length, 3);
    if (flowType === "state") { assert.equal(run.stateTransitions.length, 4); assert.equal(run.stateVersion, 4); assert.equal(new Set(run.stateTransitions.filter(row => row.toStateCode === "BODY").map(row => row.executionKey)).size, 3); }
    else { assert.equal(run.milestones.length, 3); assert.equal(new Set(run.milestones.map(row => row.executionKey)).size, 3); }
    console.log(JSON.stringify({ scenario: "sync-loop", flowType, visits: 3, distinctFacts: true, runId }));
  }
  const waitId = await create("等待返回", "control", definition([node("start", "start"), node("wait", "wait", { durationSeconds: 1 }), route("route", "back", 2), node("end", "end")], [edge("initial", "start", "wait"), edge("forward", "wait", "route"), edge("back", "route", "wait", "retry", 3), edge("finish", "route", "end", "done")]));
  const waiting = await settle(waitId); assert.equal(waiting.nodeRuns.filter(row => row.nodeId === "wait" && row.status === "success").length, 3);
  console.log(JSON.stringify({ scenario: "timer-loop", visits: 3, runId: waitId }));
  const humanId = await create("人工返回", "control", definition([node("start", "start"), node("review", "operate", { nodeDh: "REVIEW", czmc: "迭代办理", assigneeMode: "user", assigneeUserId: account.userId, signMode: "single", outcomeMode: "explicit", outcomes: [{ code: "retry", label: "重办", sourceHandle: "retry" }, { code: "approved", label: "完成", sourceHandle: "approved" }] }), node("end", "end")], [edge("initial", "start", "review"), edge("back", "review", "review", "retry", 3), edge("finish", "review", "end", "approved")]));
  const taskKeys = [];
  for (let round = 0; round < 3; round++) {
    let task;
    for (let i = 0; i < 60; i++) {
      task = (await own.request("task.list", { projectId: project.id, view: "todo", limit: 200 })).find(row => row.runId === humanId);
      if (task) break; await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(task, "人工循环没有生成下一轮待办");
    taskKeys.push(task.executionKey);
    await own.request("task.execute", { taskId: task.id, result: { decision: "approved", outcome: round < 2 ? "retry" : "approved", comment: "隔离循环办理" } }, true);
  }
  await settle(humanId); assert.equal(new Set(taskKeys).size, 3);
  console.log(JSON.stringify({ scenario: "human-loop", visits: 3, distinctTasks: true, runId: humanId }));
  const parallelId = await create("并行分支返回", "control", definition([
    node("start", "start"), node("fork", "router", { broadcast: true, parallelJoinNodeId: "join", defaultRoute: "a", routes: [{ handle: "a", targetNodeId: "waitA" }, { handle: "b", targetNodeId: "waitB" }] }),
    node("waitA", "wait", { durationSeconds: 1 }), route("inside", "innerBack", 1), node("waitB", "wait", { durationSeconds: 1 }),
    node("join", "transform", { parallelForNodeId: "fork" }), route("outside", "outerBack", 1), node("end", "end"),
  ], [edge("initial", "start", "fork"), edge("branchA", "fork", "waitA", "a"), edge("branchB", "fork", "waitB", "b"),
    edge("aRoute", "waitA", "inside"), edge("innerBack", "inside", "waitA", "retry", 1), edge("aJoin", "inside", "join", "done"), edge("bJoin", "waitB", "join"),
    edge("afterJoin", "join", "outside"), edge("outerBack", "outside", "fork", "retry", 1), edge("finish", "outside", "end", "done") ]));
  const parallel = await settle(parallelId);
  assert.equal(parallel.nodeRuns.filter(row => row.nodeId === "waitA" && row.status === "success").length, 3);
  assert.equal(parallel.nodeRuns.filter(row => row.nodeId === "waitB" && row.status === "success").length, 2);
  assert.equal(parallel.nodeRuns.filter(row => row.nodeId === "join" && row.status === "success").length, 2);
  console.log(JSON.stringify({ scenario: "parallel-loop", firstBranchVisits: 3, secondBranchVisits: 2, joins: 2, mergedCountersPreserved: true, runId: parallelId }));
  const limitId = await create("次数上限", "control", definition([node("start", "start"), node("body", "transform"), node("route", "router", { defaultRoute: "retry" }), node("end", "end")], [edge("initial", "start", "body"), edge("forward", "body", "route"), edge("back", "route", "body", "retry", 2), edge("finish", "route", "end", "done")]));
  const failed = await settle(limitId, "failed"); assert(JSON.stringify(failed.errorJson).includes("2 次上限"));
  console.log(JSON.stringify({ scenario: "loop-limit", failedAtDeclaredLimit: true, runId: limitId }));
} finally {
  const failures = [];
  for (const run of runs) {
    try { const actual = await root.request("workflow.runDetail", { runId: run.id }); assert.equal(actual.workflowId, run.workflowId); if (["queued", "running", "waiting", "blocked"].includes(actual.status)) await root.request("workflow.cancelRun", { runId: run.id }, true); } catch (error) { failures.push(error.message); }
  }
  for (const workflow of workflows) {
    try { const actual = await root.request("workflow.get", { id: workflow.id }); assert.equal(actual.name, workflow.name); assert.equal(actual.ownerUserId, account.userId); if (!actual.archivedAt) await root.request("workflow.delete", { id: workflow.id }, true); } catch (error) { failures.push(error.message); }
  }
  if (project) { try { const current = await root.request("project.lifecyclePreview", { projectId: project.id }); assert.equal(current.ownerUserId, account.userId); assert.equal(current.name, "循环隔离验收_" + tag); if (current.status === "active") await root.request("project.changeStatus", { projectId: project.id, status: "archived", expectedVersion: current.lifecycleVersion, expectedWorkflowCount: current.workflowCount }, true); } catch (error) { failures.push(error.message); } }
  if (account) { try { const users = await root.request("iam.userDirectory", { search: tag, limit: 20, offset: 0 }); assert.equal(users.items.find(row => row.username === tag)?.id, account.userId); await root.request("iam.updateUserStatus", { userId: account.userId, status: "disabled" }, true); } catch (error) { failures.push(error.message); } }
  assert.deepEqual(failures, [], "循环隔离资源清理失败");
  console.log(JSON.stringify({ cleanup: true, ownWorkflowsArchived: workflows.length, ownProjectArchived: Boolean(project), ownAccountDisabled: Boolean(account) }));
}
