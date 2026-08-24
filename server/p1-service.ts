import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { hasWorkflowPermission, recordAuthorizationAudit } from "./iam-service";
import { resumeWorkflowTask } from "./workflow-engine";
import { wakeWorkflowWorker } from "./workflow-worker";

type User = { id: number; role: "user" | "admin" };
type TaskView = "todo" | "done" | "initiated" | "all";
type JsonRecord = Record<string, unknown>;
let pool: mysql.Pool | undefined;
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return pool ??= mysql.createPool(process.env.DATABASE_URL);
};
const parseJson = (value: unknown) => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
};

function taskFilter(view: TaskView, userId: number) {
  if (view === "todo") return { clause: "t.status IN ('pending','claimed') AND (t.assignedUserId=? OR t.claimedByUserId=? OR (t.assignedUserId IS NULL AND (t.candidateUserIdsJson IS NULL OR JSON_LENGTH(t.candidateUserIdsJson)=0 OR JSON_CONTAINS(t.candidateUserIdsJson,?))))", params: [userId, userId, JSON.stringify(userId)] };
  if (view === "done") return { clause: "t.status='completed' AND t.completedByUserId=?", params: [userId] };
  if (view === "initiated") return { clause: "r.triggeredByUserId=?", params: [userId] };
  return { clause: "1=1", params: [] as Array<number | string> };
}

function candidateIds(task: mysql.RowDataPacket) {
  const parsed = parseJson(task.candidateUserIdsJson);
  return Array.isArray(parsed) ? parsed.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
}

function isTaskActor(userId: number, task: mysql.RowDataPacket) {
  return [task.assignedUserId, task.claimedByUserId, task.completedByUserId].some(value => Number(value) === userId) || candidateIds(task).includes(userId);
}

async function canAccessTask(user: User, task: mysql.RowDataPacket, write = false) {
  if (user.role === "admin") return true;
  if (write) {
    if (isTaskActor(user.id, task)) return true;
    const restricted = Boolean(task.assignedUserId) || candidateIds(task).length > 0;
    return !restricted && hasWorkflowPermission(user, String(task.workflowId), "workflow:run");
  }
  if (isTaskActor(user.id, task) || Number(task.triggeredByUserId) === user.id) return true;
  return hasWorkflowPermission(user, String(task.workflowId), "workflow:view");
}

function presentTask(row: mysql.RowDataPacket) {
  const status = String(row.status);
  const result = parseJson(row.resultJson);
  const displayStatus = status === "pending"
    ? String(row.pendingStatusName || "待审批")
    : status === "claimed"
      ? "处理中"
      : status === "completed"
        ? result?.decision === "rejected" ? "已拒绝" : result?.decision === "abstained" ? "已弃权" : "已审核"
        : "已取消";
  return {
    ...row,
    displayStatus,
    candidateUserIds: candidateIds(row),
    payload: parseJson(row.payloadJson),
    result,
    approvalProgress: row.approvalGroupId ? {
      completed: Number(row.approvedApprovals ?? 0),
      approved: Number(row.approvedApprovals ?? 0),
      rejected: Number(row.rejectedApprovals ?? 0),
      decided: Number(row.completedDecisions ?? 0),
      required: Number(row.requiredApprovals ?? 1),
      total: Number(row.totalApprovers ?? 1),
    } : null,
  };
}

export async function listWorkflowTasks(user: User, input: { view: TaskView; projectId?: string; status?: "pending" | "claimed" | "completed" | "cancelled"; limit?: number }) {
  const filter = taskFilter(input.view, user.id);
  const clauses = [filter.clause];
  const params: unknown[] = [...filter.params];
  if (input.projectId) { clauses.push("t.projectId=?"); params.push(input.projectId); }
  if (input.status) { clauses.push("t.status=?"); params.push(input.status); }
  params.push(Math.min(Math.max(input.limit ?? 100, 1), 200));
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,w.name AS workflowName,w.flowType,r.status AS runStatus,r.triggeredByUserId,initiator.name AS initiatedByName,assignee.name AS assignedName,
            g.totalApprovers,g.requiredApprovals,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed') AS completedDecisions,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='approved') AS approvedApprovals,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='rejected') AS rejectedApprovals
       FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
       LEFT JOIN workflow_task_group g ON g.id=t.approvalGroupId
       LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId LEFT JOIN users assignee ON assignee.id=t.assignedUserId
      WHERE ${clauses.join(" AND ")} ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,t.createdAt DESC LIMIT ?`,
    params,
  );
  const accessible: mysql.RowDataPacket[] = [];
  for (const row of rows) if (await canAccessTask(user, row)) accessible.push(presentTask(row));
  return accessible;
}

export async function getWorkflowTask(user: User, taskId: string) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,w.name AS workflowName,w.flowType,r.status AS runStatus,r.triggeredByUserId,initiator.name AS initiatedByName,assignee.name AS assignedName,
            g.totalApprovers,g.requiredApprovals,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed') AS completedDecisions,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='approved') AS approvedApprovals,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='rejected') AS rejectedApprovals
       FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
       LEFT JOIN workflow_task_group g ON g.id=t.approvalGroupId
       LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId LEFT JOIN users assignee ON assignee.id=t.assignedUserId WHERE t.id=? LIMIT 1`,
    [taskId],
  );
  const task = rows[0];
  if (!task || !(await canAccessTask(user, task))) return null;
  return { ...presentTask(task), nextNodeIds: parseJson(task.nextNodeIdsJson) };
}

export async function claimWorkflowTask(user: User, taskId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task) throw new Error("人工任务不存在或无访问权限。 ");
  if (!(await canAccessTask(user, task, true))) throw new Error("无权领取该人工任务。 ");
  if (task.assignedUserId && Number(task.assignedUserId) !== user.id && user.role !== "admin") throw new Error("该人工任务已指定其他处理人。 ");
  if (task.approvalGroupId && task.signMode === "sequentialSignFor") {
    const [prior] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_task WHERE approvalGroupId=? AND approvalOrder<? AND status<>'completed' LIMIT 1",
      [task.approvalGroupId, Number(task.approvalOrder ?? 0)]
    );
    if (prior[0]) throw new Error("顺序会签尚未轮到当前审批人。 ");
  }
  const [result] = await db().query<mysql.ResultSetHeader>("UPDATE workflow_task SET status='claimed',claimedByUserId=?,claimedAt=NOW() WHERE id=? AND status='pending'", [user.id, taskId]);
  if (!result.affectedRows) throw new Error("人工任务已被领取或已结束。 ");
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow_task", resourceId: taskId, details: { operation: "task_claimed" } });
  return getWorkflowTask(user, taskId);
}

export async function executeWorkflowTask(user: User, taskId: string, result: JsonRecord) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task) throw new Error("人工任务不存在或无访问权限。");
  if (task.status === "pending") await claimWorkflowTask(user, taskId);
  else if (task.status !== "claimed" || Number(task.claimedByUserId) !== user.id && user.role !== "admin") throw new Error("当前操作不可执行，请刷新任务状态。");
  return completeWorkflowTask(user, taskId, result);
}

export async function completeWorkflowTask(user: User, taskId: string, result: JsonRecord) {
  const task = await getWorkflowTask(user, taskId);
  if (!task) throw new Error("人工任务不存在或无访问权限。 ");
  if (!(await canAccessTask(user, task, true))) throw new Error("无权完成该人工任务。 ");
  const resumed = await resumeWorkflowTask({ taskId, completedBy: user, result });
  if (resumed.status === "queued") wakeWorkflowWorker();
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow_task", resourceId: taskId, details: { operation: result.decision === "rejected" ? "task_rejected" : "task_approved", decision: result.decision, runId: resumed.runId, status: resumed.status } });
  return resumed;
}

async function getEligibleAssignee(task: mysql.RowDataPacket, userId: number) {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT id,username,name,email,role,status FROM users WHERE id=? AND status='active' LIMIT 1", [userId]);
  const candidate = rows[0];
  if (!candidate) throw new Error("目标处理人不存在或已停用。 ");
  const candidateUser: User = { id: Number(candidate.id), role: candidate.role === "admin" ? "admin" : "user" };
  if (!(await hasWorkflowPermission(candidateUser, String(task.workflowId), "workflow:run"))) throw new Error("目标处理人没有该流程的运行权限。 ");
  return candidate;
}

export async function listWorkflowTaskAssignees(user: User, taskId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task || !(await canAccessTask(user, task, true))) throw new Error("人工任务不存在或无分配权限。 ");
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT id,username,name,email,role FROM users WHERE status='active' ORDER BY COALESCE(name,username),id LIMIT 200");
  const eligible: Array<{ id: number; username: string; name: string | null; email: string | null }> = [];
  for (const candidate of rows) {
    const candidateUser: User = { id: Number(candidate.id), role: candidate.role === "admin" ? "admin" : "user" };
    if (await hasWorkflowPermission(candidateUser, String(task.workflowId), "workflow:run")) {
      eligible.push({ id: Number(candidate.id), username: String(candidate.username), name: candidate.name ?? null, email: candidate.email ?? null });
    }
  }
  return eligible;
}

export async function handoverWorkflowTask(user: User, input: { taskId: string; targetUserId: number }) {
  const task: any = await getWorkflowTask(user, input.taskId);
  if (!task || !(await canAccessTask(user, task, true))) throw new Error("人工任务不存在或无移交权限。 ");
  if (!["pending", "claimed"].includes(String(task.status)) || !["running", "waiting"].includes(String(task.runStatus))) throw new Error("仅可移交正在等待处理的人工任务。 ");
  if (task.status === "claimed" && Number(task.claimedByUserId) !== user.id && user.role !== "admin") throw new Error("仅当前处理人或系统管理员可移交已领取任务。 ");
  const target = await getEligibleAssignee(task, input.targetUserId);
  const claimedCondition = task.status === "claimed" ? " AND claimedByUserId=?" : "";
  const params: unknown[] = [input.targetUserId, input.taskId, ...(task.status === "claimed" ? [Number(task.claimedByUserId)] : [])];
  const [result] = await db().query<mysql.ResultSetHeader>(`UPDATE workflow_task SET assignedUserId=?,status='pending',claimedByUserId=NULL,claimedAt=NULL WHERE id=? AND status='${task.status}'${claimedCondition}`, params);
  if (!result.affectedRows) throw new Error("人工任务状态已变化，请刷新后重试。 ");
  await recordAuthorizationAudit({ actorUserId: user.id, targetUserId: Number(target.id), action: "user_updated", resourceType: "workflow_task", resourceId: input.taskId, details: { operation: "task_handover", fromUserId: task.assignedUserId ?? task.claimedByUserId ?? null, toUserId: input.targetUserId } });
  return getWorkflowTask(user, input.taskId);
}

export async function returnWorkflowTaskToPending(user: User, taskId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task || !(await canAccessTask(user, task, true))) throw new Error("人工任务不存在或无退回权限。 ");
  if (task.status !== "claimed" || Number(task.claimedByUserId) !== user.id && user.role !== "admin") throw new Error("仅当前处理人或系统管理员可将已领取任务退回待处理。 ");
  const [result] = await db().query<mysql.ResultSetHeader>("UPDATE workflow_task SET status='pending',claimedByUserId=NULL,claimedAt=NULL WHERE id=? AND status='claimed' AND claimedByUserId=?", [taskId, Number(task.claimedByUserId)]);
  if (!result.affectedRows) throw new Error("人工任务状态已变化，请刷新后重试。 ");
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow_task", resourceId: taskId, details: { operation: "task_returned_to_pending", assignedUserId: task.assignedUserId ?? null } });
  return getWorkflowTask(user, taskId);
}

export async function batchClaimWorkflowTasks(user: User, taskIds: string[]) {
  return Promise.all(taskIds.map(async taskId => {
    try { await claimWorkflowTask(user, taskId); return { taskId, success: true as const }; }
    catch (error) { return { taskId, success: false as const, message: error instanceof Error ? error.message : String(error) }; }
  }));
}

export async function batchCompleteWorkflowTasks(user: User, taskIds: string[], result: JsonRecord) {
  return Promise.all(taskIds.map(async taskId => {
    try { const completed = await completeWorkflowTask(user, taskId, result); return { taskId, success: true as const, runId: completed.runId, status: completed.status }; }
    catch (error) { return { taskId, success: false as const, message: error instanceof Error ? error.message : String(error) }; }
  }));
}

export async function getTaskDashboard(user: User) {
  const [todo, done, initiatedTasks, initiatedInstances, allInstances] = await Promise.all([
    listWorkflowTasks(user, { view: "todo", limit: 200 }), listWorkflowTasks(user, { view: "done", limit: 200 }), listWorkflowTasks(user, { view: "initiated", limit: 200 }), listProcessInstances(user, { view: "initiated", limit: 200 }), listProcessInstances(user, { view: "all", limit: 200 }),
  ]);
  const recent = Array.from(new Map([...todo, ...done, ...initiatedTasks].map(task => [String(task.id), task])).values()).sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()).slice(0, 8);
  return { counts: { todo: todo.length, done: done.length, initiated: initiatedInstances.length, all: allInstances.length }, recent };
}

export async function listProcessInstances(user: User, input: { view: "initiated" | "all"; limit?: number }) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    input.view === "initiated"
      ? `SELECT r.*,w.name AS workflowName,w.flowType,w.projectId,initiator.name AS initiatedByName,ps.stateCode,ps.stateName,ps.flowStatus,ps.stateColor,ps.availableOperationsJson
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
           LEFT JOIN workflow_participant_state ps ON ps.id=(SELECT latest.id FROM workflow_participant_state latest WHERE latest.runId=r.id AND latest.userId=? ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 1)
          WHERE r.triggeredByUserId=? ORDER BY r.createdAt DESC LIMIT ?`
      : `SELECT r.*,w.name AS workflowName,w.flowType,w.projectId,initiator.name AS initiatedByName,ps.stateCode,ps.stateName,ps.flowStatus,ps.stateColor,ps.availableOperationsJson
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
           LEFT JOIN workflow_participant_state ps ON ps.id=(SELECT latest.id FROM workflow_participant_state latest WHERE latest.runId=r.id AND latest.userId=? ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 1)
          ORDER BY r.createdAt DESC LIMIT ?`,
    input.view === "initiated" ? [user.id, user.id, limit] : [user.id, limit],
  );
  const accessible: mysql.RowDataPacket[] = [];
  for (const row of rows) {
    if (row.stateName || await hasWorkflowPermission(user, String(row.workflowId), "workflow:view")) {
      accessible.push({ ...row, displayStatus: row.stateName || row.status, availableOperations: parseJson(row.availableOperationsJson) });
    }
  }
  return accessible;
}

export async function getTaskCalendar(user: User, month: Date) {
  const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const tasks = await listWorkflowTasks(user, { view: "all", limit: 200 });
  return tasks.filter(task => { const date = new Date(String(task.createdAt)); return date >= start && date < end; }).map(task => ({ id: task.id, title: `${task.workflowName} · ${task.nodeName}`, start: task.createdAt, status: task.status, workflowId: task.workflowId, runId: task.runId }));
}

const defaultSettings = {
  general: { platformName: "Flow AI Engine", watermarkEnabled: false, watermarkText: "" },
  approval: { requireProjectApproval: true, reviewerMode: "project_owner_or_admin" },
};

export async function getP1SystemSettings() {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM system_setting WHERE `key` IN ('general','approval')");
  const settings: Record<string, unknown> = { ...defaultSettings };
  rows.forEach(row => { settings[row.key] = parseJson(row.valueJson); });
  return settings as typeof defaultSettings;
}

export async function getPublicGeneralSettings() {
  const settings = await getP1SystemSettings();
  return { platformName: String(settings.general.platformName || "Flow AI Engine").slice(0, 120), watermarkEnabled: Boolean(settings.general.watermarkEnabled), watermarkText: String(settings.general.watermarkText || "").slice(0, 120) };
}

export async function isProjectApprovalRequired() {
  return Boolean((await getP1SystemSettings()).approval.requireProjectApproval);
}

export async function updateP1SystemSetting(user: User, key: "general" | "approval", value: JsonRecord) {
  const merged = { ...(defaultSettings[key] as JsonRecord), ...value };
  await db().query("INSERT INTO system_setting (`key`,valueJson,updatedByUserId) VALUES (?,?,?) ON DUPLICATE KEY UPDATE valueJson=VALUES(valueJson),updatedByUserId=VALUES(updatedByUserId),updatedAt=NOW()", [key, JSON.stringify(merged), user.id]);
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "system_setting", resourceId: key, details: { operation: "setting_updated" } });
  return merged;
}

export async function listWorkDomains() {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT d.*,u.name AS creatorName,u.username AS creatorUsername,(SELECT COUNT(*) FROM flow_project p WHERE p.domainId=d.id AND p.status='active') AS projectCount FROM work_domain d LEFT JOIN users u ON u.id=d.createdByUserId ORDER BY d.status,d.updatedAt DESC");
  return rows;
}

export async function listActiveWorkDomains() {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT id,code,name,description FROM work_domain WHERE status='active' ORDER BY code");
  return rows;
}

export async function createWorkDomain(user: User, input: { code: string; name: string; description?: string }) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(code)) throw new Error("工作域代号须以字母开头，且仅包含大写字母、数字、下划线或连字符。 ");
  const id = randomUUID();
  await db().query("INSERT INTO work_domain (id,code,name,description,createdByUserId) VALUES (?,?,?,?,?)", [id, code, input.name.trim(), input.description?.trim() || null, user.id]);
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "work_domain", resourceId: id, details: { operation: "domain_created", code } });
  return id;
}

export async function updateWorkDomain(user: User, input: { id: string; name?: string; description?: string | null; status?: "active" | "disabled" }) {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM work_domain WHERE id=? LIMIT 1", [input.id]);
  const domain = rows[0];
  if (!domain) throw new Error("工作域不存在。 ");
  await db().query("UPDATE work_domain SET name=?,description=?,status=?,updatedAt=NOW() WHERE id=?", [input.name?.trim() || domain.name, input.description === undefined ? domain.description : input.description?.trim() || null, input.status ?? domain.status, input.id]);
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "work_domain", resourceId: input.id, details: { operation: "domain_updated" } });
  return true;
}
