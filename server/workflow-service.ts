import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { getWorkflowAccess, hasSystemPermission, recordAuthorizationAudit, type WorkflowPermission } from "./iam-service";

type Node = { id: string; type: "start" | "end" | "transform" | "condition" | "http" | "llm"; name: string; position: { x: number; y: number }; config: Record<string, unknown> };
type Edge = { id: string; sourceNodeId: string; sourceHandle?: string; targetNodeId: string };
export type Definition = { schemaVersion: 1; viewport: { x: number; y: number; zoom: number }; nodes: Node[]; edges: Edge[]; settings: Record<string, unknown> };
const id = () => randomBytes(12).toString("base64url");
let pool: mysql.Pool | undefined;
const db = () => { if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。"); return pool ??= mysql.createPool(process.env.DATABASE_URL); };
export const emptyDefinition = (): Definition => ({ schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes: [{ id: "start", type: "start", name: "开始", position: { x: 90, y: 180 }, config: { initialVariables: {} } }, { id: "end", type: "end", name: "结束", position: { x: 430, y: 180 }, config: { resultTemplate: "{{result}}" } }], edges: [{ id: "start-end", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "end" }] });
export function validate(definition: unknown, executable = false): Definition {
  const value = definition as Definition;
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error("流程定义格式无效。");
  const nodeTypes = new Set(["start", "end", "transform", "condition", "http", "llm"]);
  for (const node of value.nodes) {
    if (!node || typeof node.id !== "string" || !node.id.trim() || typeof node.name !== "string" || !nodeTypes.has(node.type)) throw new Error("流程节点格式或类型无效。");
    if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) throw new Error("流程节点位置无效。");
    if (!node.config || typeof node.config !== "object" || Array.isArray(node.config)) throw new Error("流程节点配置必须是 JSON 对象。");
  }
  const starts = value.nodes.filter(node => node.type === "start"), ends = value.nodes.filter(node => node.type === "end");
  if (starts.length !== 1 || ends.length !== 1) throw new Error("流程必须且仅能包含一个开始节点和一个结束节点。");
  if (new Set(value.nodes.map(node => node.id)).size !== value.nodes.length) throw new Error("节点 ID 不可重复。");
  const nodeIds = new Set(value.nodes.map(node => node.id));
  for (const edge of value.edges) {
    if (!edge || typeof edge.id !== "string" || !edge.id.trim() || !nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) throw new Error("流程连线引用了不存在的节点。");
  }
  if (executable && !value.edges.some(edge => edge.sourceNodeId === starts[0].id)) throw new Error("开始节点必须连接后继节点。");
  return value;
}
type WorkflowUser = { id: number; role: "user" | "admin" };

function hydrateWorkflow(row: mysql.RowDataPacket) {
  const definition = typeof row.definitionJson === "string" ? JSON.parse(row.definitionJson) : row.definitionJson;
  return { ...row, definition };
}

export async function listWorkflows(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    user.role === "admin"
      ? "SELECT DISTINCT w.* FROM workflow w ORDER BY w.updatedAt DESC"
      : `SELECT DISTINCT w.* FROM workflow w
          LEFT JOIN workflow_member wm ON wm.workflowId=w.id AND wm.userId=? AND wm.revokedAt IS NULL AND wm.effectiveFrom<=NOW() AND (wm.expiresAt IS NULL OR wm.expiresAt>NOW())
          LEFT JOIN role_assignment ra ON ra.userId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW()) AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=w.id))
          LEFT JOIN role_permission rp ON rp.roleId=ra.roleId
          LEFT JOIN permission p ON p.id=rp.permissionId
         WHERE w.ownerUserId=? OR wm.id IS NOT NULL OR p.code='workflow:view'
         ORDER BY w.updatedAt DESC`,
    user.role === "admin" ? [] : [user.id, user.id, user.id],
  );
  return rows.map(hydrateWorkflow);
}

export async function getWorkflow(idValue: string, user: WorkflowUser) {
  if (!(await getWorkflowAccess(user, idValue)).permissions.has("workflow:view")) return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow WHERE id=? LIMIT 1", [idValue]);
  const row = rows[0];
  return row ? hydrateWorkflow(row) : null;
}

export async function canCreateWorkflow(user: WorkflowUser) {
  return hasSystemPermission(user, "workflow:create");
}

export async function createWorkflow(user: WorkflowUser, name: string, description?: string) {
  if (!(await canCreateWorkflow(user))) throw new Error("当前账号没有创建流程的权限。");
  const workflowId = id();
  const definition = emptyDefinition();
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("INSERT INTO workflow (id,ownerUserId,name,description,definitionJson,status,definitionVersion) VALUES (?,?,?,?,?,'draft',1)", [workflowId, user.id, name, description ?? null, JSON.stringify(definition)]);
    await connection.query("INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)", [randomBytes(18).toString("hex"), workflowId, user.id, user.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getWorkflow(workflowId, user);
}

export async function hasWorkflowPermission(user: WorkflowUser, workflowId: string, permission: WorkflowPermission) {
  return (await getWorkflowAccess(user, workflowId)).permissions.has(permission);
}

export async function updateWorkflow(workflowId: string, user: WorkflowUser, values: { name?: string; definition?: unknown; publish?: boolean }) {
  const permission: WorkflowPermission = values.publish ? "workflow:publish" : "workflow:edit";
  if (!(await hasWorkflowPermission(user, workflowId, permission))) return null;
  const current = await getWorkflow(workflowId, user) as ({ name: string; status: "draft" | "published"; definition: Definition } | null);
  if (!current) return null;
  const definition = values.definition === undefined ? current.definition : validate(values.definition, Boolean(values.publish));
  await db().query("UPDATE workflow SET name=?, definitionJson=?, status=?, definitionVersion=definitionVersion+1, updatedAt=NOW() WHERE id=?", [values.name ?? current.name, JSON.stringify(definition), values.publish ? "published" : current.status, workflowId]);
  return getWorkflow(workflowId, user);
}

export async function duplicateWorkflow(workflowId: string, user: WorkflowUser, name?: string) {
  const source = await getWorkflow(workflowId, user) as ({ name: string; description?: string | null; definition: Definition } | null);
  if (!source) return null;
  const duplicated = await createWorkflow(user, name?.trim() || `${source.name} · 副本`, source.description ?? undefined);
  if (!duplicated) return null;
  return updateWorkflow((duplicated as any).id, user, { definition: source.definition });
}

export async function deleteWorkflow(workflowId: string, user: WorkflowUser) {
  if (!(await hasWorkflowPermission(user, workflowId, "workflow:members:manage"))) return false;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?", [workflowId]);
    await connection.query("DELETE FROM workflow_run WHERE workflowId=?", [workflowId]);
    await connection.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
    await connection.query("UPDATE role_assignment SET revokedAt=NOW(),revokedByUserId=? WHERE scopeType='workflow' AND scopeId=? AND revokedAt IS NULL", [user.id, workflowId]);
    const [result] = await connection.query<mysql.ResultSetHeader>("DELETE FROM workflow WHERE id=?", [workflowId]);
    if (!result.affectedRows) throw new Error("流程不存在或已被删除。");
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow", resourceId: workflowId, details: { operation: "workflow_deleted" } });
  return true;
}
