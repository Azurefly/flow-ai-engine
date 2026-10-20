// Run in the deployed app container against public 1180. The only SQL writes claim/release newly owned test jobs.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import mysql from "mysql2/promise";
import superjson from "superjson";

const base = "http://124.223.198.84:1180";
const lab = process.env.FLOW_RECOVERY_LAB;
assert(lab && /^\/tmp\/flow-loop-recovery-[a-f0-9]{12}$/.test(lab) && realpathSync(lab) === lab);
const compiled = spawnSync("/app/node_modules/.bin/esbuild", [lab + "/scripts/loop-recovery-worker.ts", "--bundle", "--platform=node", "--format=esm", "--packages=external", "--tsconfig=" + lab + "/tsconfig.json", "--outfile=" + lab + "/worker.mjs"], { cwd: lab, encoding: "utf8" });
assert.equal(compiled.status, 0, "隔离 Worker 编译失败：" + compiled.stderr);
const pool = mysql.createPool(process.env.DATABASE_URL);
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    if (mutation && ["project.auditWorkflow", "project.resetWorkflowAudit"].includes(path) && input?.workflowId && input.expectedDefinitionVersion === undefined && input.expectedAuditStatus === undefined) {
      const current = await this.request("workflow.get", { id: input.workflowId });
      input = { ...input, expectedDefinitionVersion: Number(current.definitionVersion), expectedAuditStatus: current.auditStatus };
    }
    const body = JSON.stringify(superjson.serialize(input ?? null));
    const response = await fetch(`${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`, { method: mutation ? "POST" : "GET", headers: { "content-type": "application/json", cookie: this.cookie }, ...(mutation ? { body } : {}), signal: AbortSignal.timeout(30000) });
    const next = response.headers.getSetCookie()[0]; if (next) this.cookie = next.split(";", 1)[0];
    const payload = await response.json(); assert(response.ok && !payload.error, payload.error?.json?.message ?? `HTTP ${response.status}`);
    return superjson.deserialize(payload.result.data);
  }
}
const root = new Session(), own = new Session();
const tag = "recover_" + randomBytes(6).toString("hex"), password = "Test9_" + randomBytes(24).toString("base64url");
let account, project; const workflows = [], runs = [];
const reportFixture = () => console.log(JSON.stringify({ fixture: { tag, ownerUserId: account?.userId, projectId: project?.id, workflows, runs } }));
const node = (id, type, config = {}) => ({ id, type, name: id, config, position: { x: 0, y: 0 } });
const edge = (id, sourceNodeId, targetNodeId, sourceHandle, loop) => ({ id, sourceNodeId, targetNodeId, ...(sourceHandle ? { sourceHandle } : {}), ...(loop ? { loop: { maxIterations: loop } } : {}) });
const definition = (nodes, edges) => ({ schemaVersion: 1, settings: {}, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges });
const router = node("route", "router", { defaultRoute: "done", routes: [{ handle: "retry", condition: { left: "{{runtime.loopIterations.back}}", operator: "lessThan", right: 2 } }] });
const readJson = value => typeof value === "string" ? JSON.parse(value) : value;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(runId, predicate) {
  for (let count = 0; count < 120; count++) {
    const run = await own.request("workflow.runDetail", { runId });
    assert(!["failed", "cancelled", "terminated"].includes(run.status), JSON.stringify(run.errorJson));
    if (predicate(run)) return run;
    await delay(500);
  }
  throw new Error("隔离恢复运行未达到目标状态。");
}
async function create(name, type, def) {
  const workflow = await own.request("project.createWorkflow", { projectId: project.id, name: name + "_" + tag, flowType: type, definition: def }, true);
  workflows.push({ id: workflow.id, name: name + "_" + tag });
  reportFixture();
  await root.request("project.auditWorkflow", { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" }, true);
  const latest = await own.request("workflow.get", { id: workflow.id });
  await own.request("workflow.publish", { id: workflow.id, expectedDefinitionVersion: latest.definitionVersion }, true);
  return workflows.at(-1);
}
async function reserve(workflow) {
  const actual = await own.request("workflow.get", { id: workflow.id });
  assert(actual.ownerUserId === account.userId && actual.projectId === project.id && actual.name === workflow.name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = await own.request("workflow.run", { workflowId: workflow.id, triggerType: "manual", idempotencyKey: `${tag}_${workflow.id}_${attempt}` }, true);
    runs.push({ id: started.runId, workflowId: workflow.id });
    reportFixture();
    const [found] = await pool.query("SELECT id FROM workflow_run_job WHERE runId=? ORDER BY createdAt LIMIT 1", [started.runId]);
    assert(found[0], "新建测试任务不存在。");
    const connection = await pool.getConnection();
    let reserved;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query("SELECT * FROM workflow_run_job WHERE id=? AND runId=? FOR UPDATE", [found[0].id, started.runId]);
      const job = rows[0];
      const [runRows] = await connection.query("SELECT ownerUserId,workflowId,status,executionLockToken FROM workflow_run WHERE id=? FOR UPDATE", [started.runId]);
      const run = runRows[0];
      assert(job && run && run.ownerUserId === account.userId && run.workflowId === workflow.id);
      if (job.status === "queued" && run.status === "queued" && !run.executionLockToken) {
        const leaseToken = randomUUID().replaceAll("-", "");
        const [claimed] = await connection.query("UPDATE workflow_run_job SET status='leased',attempt=attempt+1,workerId='isolated-recovery',leaseToken=?,leaseExpiresAt=DATE_ADD(NOW(),INTERVAL 60 SECOND) WHERE id=? AND status='queued'", [leaseToken, job.id]);
        assert.equal(claimed.affectedRows, 1);
        const [locked] = await connection.query("UPDATE workflow_run SET status='running',startedAt=COALESCE(startedAt,NOW()),executionLockToken=?,executionLockExpiresAt=DATE_ADD(NOW(),INTERVAL 60 SECOND) WHERE id=? AND status='queued' AND executionLockToken IS NULL", [leaseToken, started.runId]);
        assert.equal(locked.affectedRows, 1);
        reserved = { tag, runId: started.runId, jobId: job.id, leaseToken, ownerUserId: account.userId, projectId: project.id, workflowName: workflow.name };
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); if (error.code !== "ER_LOCK_DEADLOCK") throw error; console.log(JSON.stringify({ stage: "reservation-rolled-back", runId: started.runId })); }
    finally { connection.release(); }
    if (reserved) return reserved;
    // The regular worker won the claim; cancel this owned run before making a new isolated attempt.
    const current = await own.request("workflow.runDetail", { runId: started.runId });
    if (["queued", "running", "waiting", "blocked"].includes(current.status)) await own.request("workflow.cancelRun", { runId: started.runId }, true);
    assert(["success", "failed", "cancelled", "terminated"].includes((await own.request("workflow.runDetail", { runId: started.runId })).status), "领取失败的旧尝试尚未结束。");
  }
  throw new Error("无法独占新测试任务，未对其他任务注入故障。");
}
async function crash(job, point, minStep = 0) {
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [lab + "/worker.mjs"], { cwd: lab, env: { ...process.env, NODE_ENV: "test", FLOW_RECOVERY_JOB: JSON.stringify(job), WORKFLOW_WORKER_FAULT_POINT: point, WORKFLOW_WORKER_FAULT_MIN_STEP: String(minStep) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); }); child.stderr.on("data", chunk => { errors += chunk.toString(); });
    child.on("error", reject); child.on("close", (code, signal) => resolve({ code, signal, reached: output.split("\n").some(line => { try { const value = JSON.parse(line); return value.faultReached === true && value.runId === job.runId; } catch { return false; } }), errors }));
  });
  assert(exit.reached && exit.signal === "SIGKILL", "测试进程未在指定已提交边界被实际终止：" + exit.errors);
  const [rows] = await pool.query("SELECT j.status,j.leaseToken,r.ownerUserId,w.name,w.projectId FROM workflow_run_job j JOIN workflow_run r ON r.id=j.runId JOIN workflow w ON w.id=r.workflowId WHERE j.id=? AND j.runId=?", [job.jobId, job.runId]);
  assert(rows[0]?.status === "leased" && rows[0].leaseToken === job.leaseToken && rows[0].ownerUserId === account.userId && rows[0].name === job.workflowName && rows[0].projectId === project.id);
  // Shorten only the terminated process's owned lease; the normal Worker handles its actual expiry.
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [released] = await connection.query("UPDATE workflow_run_job SET leaseExpiresAt=DATE_ADD(NOW(),INTERVAL 2 SECOND) WHERE id=? AND runId=? AND status='leased' AND leaseToken=?", [job.jobId, job.runId, job.leaseToken]);
    assert.equal(released.affectedRows, 1);
    const [unlocked] = await connection.query("UPDATE workflow_run SET executionLockExpiresAt=DATE_ADD(NOW(),INTERVAL 2 SECOND) WHERE id=? AND status='running' AND executionLockToken=? AND ownerUserId=?", [job.runId, job.leaseToken, account.userId]);
    assert.equal(unlocked.affectedRows, 1); await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  console.log(JSON.stringify({ stage: "isolated-process-killed", point, minStep, signal: exit.signal, runId: job.runId }));
}
async function assertReclaimed(job) {
  const [rows] = await pool.query("SELECT j.status,j.attempt,j.workerId,j.leaseToken,r.ownerUserId,r.executionLockToken FROM workflow_run_job j JOIN workflow_run r ON r.id=j.runId WHERE j.id=? AND j.runId=?", [job.jobId, job.runId]);
  assert(rows[0]?.ownerUserId === account.userId && rows[0].status === "completed" && rows[0].attempt >= 2 && rows[0].workerId !== "isolated-recovery" && rows[0].leaseToken === null && rows[0].executionLockToken === null);
}
try {
  await root.request("auth.login", { username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME, password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD }, true);
  account = await root.request("iam.createUser", { username: tag, password, name: "恢复隔离验收_" + tag, role: "admin" }, true);
  await own.request("auth.login", { username: tag, password }, true);
  project = await own.request("project.create", { code: tag.toUpperCase(), name: "恢复隔离验收_" + tag }, true);
  reportFixture();
  const stateFlow = await create("状态循环中断", "state", definition([node("start", "start"), node("body", "state", { stateCode: "BODY", displayName: "重复办理", stateType: "business" }), router, node("done", "state", { stateCode: "DONE", displayName: "已完成", stateType: "terminal" }), node("end", "end")], [edge("initial", "start", "body"), edge("forward", "body", "route"), edge("back", "route", "body", "retry", 2), edge("finish", "route", "done", "done"), edge("terminal", "done", "end")]));
  const stateJob = await reserve(stateFlow); await crash(stateJob, "after_state_commit_before_checkpoint", 4);
  const state = await waitFor(stateJob.runId, run => run.status === "success");
  assert.equal(state.stateVersion, 4); assert.equal(state.stateTransitions.length, 4);
  assert.equal(state.currentStateCode, "DONE");
  assert.equal(new Set(state.stateTransitions.map(row => row.executionKey)).size, 4);
  assert.equal(readJson(state.contextJson).runtime.executionStepCount, 9);
  await assertReclaimed(stateJob);
  console.log(JSON.stringify({ scenario: "state-loop-recovery", transitions: 4, secondVisitCommitReplayedOnce: true, cumulativeSteps: 9, danglingRunningNodes: state.nodeRuns.filter(row => row.status === "running").length }));
  const humanFlow = await create("人工循环中断", "control", definition([node("start", "start"), node("review", "operate", { nodeDh: "REVIEW", czmc: "恢复办理", assigneeMode: "user", assigneeUserId: account.userId, signMode: "single", outcomeMode: "explicit", outcomes: [{ code: "retry", label: "重办", sourceHandle: "retry" }, { code: "approved", label: "完成", sourceHandle: "approved" }] }), node("end", "end")], [edge("initial", "start", "review"), edge("back", "review", "review", "retry", 2), edge("finish", "review", "end", "approved")]));
  const humanJob = await reserve(humanFlow); await crash(humanJob, "after_human_commit_before_checkpoint");
  const keys = [];
  for (let round = 0; round < 3; round++) {
    await waitFor(humanJob.runId, run => run.status === "waiting");
    const tasks = (await own.request("task.list", { projectId: project.id, view: "todo", limit: 50 })).filter(row => row.runId === humanJob.runId);
    assert.equal(tasks.length, 1); keys.push(tasks[0].executionKey);
    await own.request("task.execute", { taskId: tasks[0].id, result: { decision: "approved", outcome: round < 2 ? "retry" : "approved", comment: "隔离恢复办理" } }, true);
  }
  const human = await waitFor(humanJob.runId, run => run.status === "success");
  assert.equal(new Set(keys).size, 3); assert.equal(readJson(human.contextJson).runtime.executionStepCount, 5);
  await assertReclaimed(humanJob);
  console.log(JSON.stringify({ scenario: "human-loop-recovery", tasks: 3, taskCommitReplayedOnce: true, cumulativeSteps: 5 }));
  const messageFlow = await create("消息循环中断", "control", definition([node("start", "start"), node("wait", "message_catch", { messageName: tag, correlationKey: tag }), router, node("end", "end")], [edge("initial", "start", "wait"), edge("forward", "wait", "route"), edge("back", "route", "wait", "retry", 2), edge("finish", "route", "end", "done")]));
  const messageJob = await reserve(messageFlow); await crash(messageJob, "after_wait_commit_before_checkpoint");
  for (let round = 0; round < 3; round++) {
    await waitFor(messageJob.runId, run => run.status === "waiting");
    const [waits] = await pool.query("SELECT id,executionKey FROM workflow_wait_subscription WHERE runId=? AND status='active'", [messageJob.runId]); assert.equal(waits.length, 1);
    await own.request("task.signalMessage", { runId: messageJob.runId, messageName: tag, correlationKey: tag, payload: { round } }, true);
  }
  const message = await waitFor(messageJob.runId, run => run.status === "success");
  const [waits] = await pool.query("SELECT id,executionKey FROM workflow_wait_subscription WHERE runId=?", [messageJob.runId]);
  assert.equal(waits.length, 3); assert.equal(new Set(waits.map(row => row.executionKey)).size, 3); assert.equal(readJson(message.contextJson).runtime.executionStepCount, 8);
  await assertReclaimed(messageJob);
  console.log(JSON.stringify({ scenario: "message-loop-recovery", waits: 3, waitCommitReplayedOnce: true, cumulativeSteps: 8 }));
} catch (error) {
  console.error(JSON.stringify({ failure: true, message: error.message, code: error.code ?? null }));
  throw error;
} finally {
  const failures = [];
  for (const run of runs) { try { const actual = await own.request("workflow.runDetail", { runId: run.id }); assert.equal(actual.workflowId, run.workflowId); assert.equal(actual.ownerUserId, account.userId); if (["queued", "running", "waiting", "blocked"].includes(actual.status)) await own.request("workflow.cancelRun", { runId: run.id }, true); } catch (error) { failures.push(error.message); } }
  for (const workflow of workflows) { try { const actual = await root.request("workflow.get", { id: workflow.id }); assert.equal(actual.ownerUserId, account.userId); assert.equal(actual.name, workflow.name); if (!actual.archivedAt) await root.request("workflow.delete", { id: workflow.id }, true); } catch (error) { failures.push(error.message); } }
  if (project) { try { const actual = await root.request("project.lifecyclePreview", { projectId: project.id }); assert.equal(actual.ownerUserId, account.userId); assert.equal(actual.name, "恢复隔离验收_" + tag); if (actual.status === "active") await root.request("project.changeStatus", { projectId: project.id, status: "archived", expectedVersion: actual.lifecycleVersion, expectedWorkflowCount: actual.workflowCount }, true); } catch (error) { failures.push(error.message); } }
  if (account) { try { const directory = await root.request("iam.userDirectory", { search: tag, limit: 20, offset: 0 }); assert.equal(directory.items.find(row => row.username === tag)?.id, account.userId); await root.request("iam.updateUserStatus", { userId: account.userId, status: "disabled" }, true); } catch (error) { failures.push(error.message); } }
  await pool.end(); assert.deepEqual(failures, [], "恢复隔离资源清理失败。");
  console.log(JSON.stringify({ cleanup: true, ownWorkflowsArchived: workflows.length, ownProjectArchived: Boolean(project), ownAccountDisabled: Boolean(account) }));
}
