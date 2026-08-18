import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { hasWorkflowPermission, recordAuthorizationAudit } from "./iam-service";
import { resumeWorkflowTask } from "./workflow-engine";

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
  if (view === "todo") return { clause: "t.status IN ('pending','claimed') AND (t.assignedUserId IS NULL OR t.assignedUserId=?)", params: [userId] };
  if (view === "done") return { clause: "t.status='completed' AND t.completedByUserId=?", params: [userId] };
  if (view === "initiated") return { clause: "r.triggeredByUserId=?", params: [userId] };
  return { clause: "1=1", params: [] as number[] };
}

async function canAccessTask(user: User, task: mysql.RowDataPacket, write = false) {
  if (user.role === "admin") return true;
  return hasWorkflowPermission(user, String(task.workflowId), write ? "workflow:run" : "workflow:view");
}

export async function listWorkflowTasks(user: User, input: { view: TaskView; projectId?: string; status?: "pending" | "claimed" | "completed" | "cancelled"; limit?: number }) {
  const filter = taskFilter(input.view, user.id);
  const clauses = [filter.clause];
  const params: unknown[] = [...filter.params];
  if (input.projectId) { clauses.push("t.projectId=?"); params.push(input.projectId); }
  if (input.status) { clauses.push("t.status=?"); params.push(input.status); }
  params.push(Math.min(Math.max(input.limit ?? 100, 1), 200));
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,w.name AS workflowName,w.flowType,r.status AS runStatus,r.triggeredByUserId,initiator.name AS initiatedByName,assignee.name AS assignedName
       FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
       LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId LEFT JOIN users assignee ON assignee.id=t.assignedUserId
      WHERE ${clauses.join(" AND ")} ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,t.createdAt DESC LIMIT ?`,
    params,
  );
  const accessible: mysql.RowDataPacket[] = [];
  for (const row of rows) if (await canAccessTask(user, row)) accessible.push({ ...row, payload: parseJson(row.payloadJson), result: parseJson(row.resultJson) });
  return accessible;
}

export async function getWorkflowTask(user: User, taskId: string) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,w.name AS workflowName,w.flowType,r.status AS runStatus,r.triggeredByUserId,initiator.name AS initiatedByName,assignee.name AS assignedName
       FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
       LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId LEFT JOIN users assignee ON assignee.id=t.assignedUserId WHERE t.id=? LIMIT 1`,
    [taskId],
  );
  const task = rows[0];
  if (!task || !(await canAccessTask(user, task))) return null;
  return { ...task, payload: parseJson(task.payloadJson), result: parseJson(task.resultJson), nextNodeIds: parseJson(task.nextNodeIdsJson) };
}

export async function claimWorkflowTask(user: User, taskId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task) throw new Error("人工任务不存在或无访问权限。 ");
  if (!(await canAccessTask(user, task, true))) throw new Error("无权领取该人工任务。 ");
  if (task.assignedUserId && Number(task.assignedUserId) !== user.id && user.role !== "admin") throw new Error("该人工任务已指定其他处理人。 ");
  const [result] = await db().query<mysql.ResultSetHeader>("UPDATE workflow_task SET status='claimed',claimedByUserId=?,claimedAt=NOW() WHERE id=? AND status='pending'", [user.id, taskId]);
  if (!result.affectedRows) throw new Error("人工任务已被领取或已结束。 ");
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow_task", resourceId: taskId, details: { operation: "task_claimed" } });
  return getWorkflowTask(user, taskId);
}

export async function completeWorkflowTask(user: User, taskId: string, result: JsonRecord) {
  const task = await getWorkflowTask(user, taskId);
  if (!task) throw new Error("人工任务不存在或无访问权限。 ");
  if (!(await canAccessTask(user, task, true))) throw new Error("无权完成该人工任务。 ");
  const resumed = await resumeWorkflowTask({ taskId, completedBy: user, result });
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow_task", resourceId: taskId, details: { operation: "task_completed", runId: resumed.runId, status: resumed.status } });
  return resumed;
}

export async function getTaskDashboard(user: User) {
  const [todo, done, initiated, all] = await Promise.all([
    listWorkflowTasks(user, { view: "todo", limit: 200 }), listWorkflowTasks(user, { view: "done", limit: 200 }), listWorkflowTasks(user, { view: "initiated", limit: 200 }), listWorkflowTasks(user, { view: "all", limit: 200 }),
  ]);
  const recent = Array.from(new Map([...todo, ...done, ...initiated].map(task => [String(task.id), task])).values()).sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()).slice(0, 8);
  return { counts: { todo: todo.length, done: done.length, initiated: initiated.length, all: all.length }, recent };
}

export async function listProcessInstances(user: User, input: { view: "initiated" | "all"; limit?: number }) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    input.view === "initiated"
      ? `SELECT r.*,w.name AS workflowName,w.flowType,w.projectId,initiator.name AS initiatedByName
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
          WHERE r.triggeredByUserId=? ORDER BY r.createdAt DESC LIMIT ?`
      : `SELECT r.*,w.name AS workflowName,w.flowType,w.projectId,initiator.name AS initiatedByName
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
          ORDER BY r.createdAt DESC LIMIT ?`,
    input.view === "initiated" ? [user.id, limit] : [limit],
  );
  const accessible: mysql.RowDataPacket[] = [];
  for (const row of rows) if (await hasWorkflowPermission(user, String(row.workflowId), "workflow:view")) accessible.push(row);
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
