import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { getWorkflowAccess, hasSystemPermission, recordAuthorizationAudit, type WorkflowPermission } from "./iam-service";
import { isProjectApprovalRequired } from "./p1-service";
import { canConnectFlowNodeTypes, FLOW_NODE_TYPES, isFlowNodeType, type FlowNodeType, validateNodeConfig, withNodeConfigDefaults } from "@shared/workflow-node-contract";

type Node = { id: string; type: FlowNodeType; name: string; position: { x: number; y: number }; config: Record<string, unknown> };
type Edge = { id: string; sourceNodeId: string; sourceHandle?: string; targetNodeId: string };
export type Definition = { schemaVersion: 1; viewport: { x: number; y: number; zoom: number }; nodes: Node[]; edges: Edge[]; settings: Record<string, unknown> };
const id = () => randomBytes(12).toString("base64url");
let pool: mysql.Pool | undefined;
const db = () => { if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。"); return pool ??= mysql.createPool(process.env.DATABASE_URL); };
export const emptyDefinition = (): Definition => ({ schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes: [{ id: "start", type: "start", name: "开始", position: { x: 90, y: 180 }, config: { initialVariables: {} } }, { id: "end", type: "end", name: "结束", position: { x: 430, y: 180 }, config: { resultTemplate: "{{result}}" } }], edges: [{ id: "start-end", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "end" }] });
export function validate(definition: unknown, executable = false): Definition {
  const value = definition as Definition;
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error("流程定义格式无效。");
  for (const node of value.nodes) {
    if (!node || typeof node.id !== "string" || !node.id.trim() || typeof node.name !== "string" || !isFlowNodeType(node.type)) throw new Error("流程节点格式或类型无效。");
    if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) throw new Error("流程节点位置无效。");
    if (!node.config || typeof node.config !== "object" || Array.isArray(node.config)) throw new Error("流程节点配置必须是 JSON 对象。");
    // 原始画布以红/蓝/绿表示未完整配置、配置中和已配置；草稿必须可保存，
    // 仅在发布或创建可执行子流程时阻断缺少执行必需字段的定义。
    if (executable) validateNodeConfig(node.type, withNodeConfigDefaults(node.type, node.config));
  }
  const starts = value.nodes.filter(node => node.type === "start"), ends = value.nodes.filter(node => node.type === "end");
  if (starts.length !== 1 || ends.length !== 1) throw new Error("流程必须且仅能包含一个开始节点和一个结束节点。");
  if (new Set(value.nodes.map(node => node.id)).size !== value.nodes.length) throw new Error("节点 ID 不可重复。");
  const nodeIds = new Set(value.nodes.map(node => node.id));
  const nodesById = new Map(value.nodes.map(node => [node.id, node]));
  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const outgoing = new Map(value.nodes.map(node => [node.id, [] as Edge[]]));
  const incoming = new Map(value.nodes.map(node => [node.id, [] as Edge[]]));
  for (const edge of value.edges) {
    if (!edge || typeof edge.id !== "string" || !edge.id.trim() || !nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) throw new Error("流程连线引用了不存在的节点。");
    if (edgeIds.has(edge.id)) throw new Error(`流程连线 ID 不可重复：${edge.id}。`);
    edgeIds.add(edge.id);
    if (edge.sourceNodeId === edge.targetNodeId) throw new Error(`流程不允许节点自环：${edge.sourceNodeId}。`);
    const sourceNode = nodesById.get(edge.sourceNodeId)!;
    const targetNode = nodesById.get(edge.targetNodeId)!;
    if (sourceNode.type !== "end" && targetNode.type !== "start" && !canConnectFlowNodeTypes(sourceNode.type, targetNode.type)) throw new Error(`节点类型不允许连接：${sourceNode.name}（${sourceNode.type}）→ ${targetNode.name}（${targetNode.type}）。`);
    const edgeKey = `${edge.sourceNodeId}|${edge.sourceHandle ?? "default"}|${edge.targetNodeId}`;
    if (edgeKeys.has(edgeKey)) throw new Error(`流程不允许重复连线：${edge.sourceNodeId} → ${edge.targetNodeId}。`);
    edgeKeys.add(edgeKey);
    outgoing.get(edge.sourceNodeId)!.push(edge);
    incoming.get(edge.targetNodeId)!.push(edge);
  }
  if (executable) {
    const startId = starts[0].id;
    const endId = ends[0].id;
    if (incoming.get(startId)!.length) throw new Error("开始节点不允许存在入边。");
    if (outgoing.get(endId)!.length) throw new Error("结束节点不允许存在出边。");
    if (!outgoing.get(startId)!.length) throw new Error("开始节点必须连接后继节点。");

    const reachable = new Set<string>();
    const visitQueue = [startId];
    while (visitQueue.length) {
      const nodeId = visitQueue.shift()!;
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const edge of outgoing.get(nodeId) ?? []) visitQueue.push(edge.targetNodeId);
    }
    const unreachable = value.nodes.filter(node => !reachable.has(node.id));
    if (unreachable.length) throw new Error(`存在从开始节点不可达的节点：${unreachable.map(node => node.name || node.id).join("、")}。`);

    const canReachEnd = new Set<string>();
    const reverseQueue = [endId];
    while (reverseQueue.length) {
      const nodeId = reverseQueue.shift()!;
      if (canReachEnd.has(nodeId)) continue;
      canReachEnd.add(nodeId);
      for (const edge of incoming.get(nodeId) ?? []) reverseQueue.push(edge.sourceNodeId);
    }
    const deadEnds = value.nodes.filter(node => !canReachEnd.has(node.id));
    if (deadEnds.length) throw new Error(`存在无法到达结束节点的路径：${deadEnds.map(node => node.name || node.id).join("、")}。`);

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const assertAcyclic = (nodeId: string) => {
      if (visiting.has(nodeId)) throw new Error(`流程存在未声明执行语义的循环：${nodesById.get(nodeId)?.name || nodeId}。`);
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      for (const edge of outgoing.get(nodeId) ?? []) assertAcyclic(edge.targetNodeId);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };
    assertAcyclic(startId);
  }
  return value;
}
type WorkflowUser = { id: number; role: "user" | "admin" };
type VersionSource = "created" | "updated" | "published" | "unpublished" | "rolled_back";
type TemplateNodeType = Exclude<Node["type"], "start" | "end" | "subflow">;

const templateNodeTypes = new Set<TemplateNodeType>(["llm", "http", "transform", "condition"]);

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function assertJsonObject(value: unknown, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function hydrateWorkflow(row: mysql.RowDataPacket) {
  const definition = parseJson(row.definitionJson);
  return { ...row, definition };
}

async function insertVersion(connection: mysql.PoolConnection, input: { workflowId: string; version: number; name: string; status: "draft" | "published"; definition: Definition; source: VersionSource; actorUserId: number; restoredFromVersion?: number | null }) {
  await connection.query(
    "INSERT INTO workflow_version (id,workflowId,version,name,status,definitionJson,changeSource,restoredFromVersion,createdByUserId) VALUES (?,?,?,?,?,?,?,?,?)",
    [id(), input.workflowId, input.version, input.name, input.status, JSON.stringify(input.definition), input.source, input.restoredFromVersion ?? null, input.actorUserId],
  );
}

async function resolveSubflowReferences(definition: Definition, ownerUserId: number, executable: boolean) {
  const subflowNodes = definition.nodes.filter(node => node.type === "subflow");
  if (!subflowNodes.length) return definition;
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT id,name,isEnabled FROM workflow_subflow WHERE ownerUserId=?", [ownerUserId]);
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const byName = new Map<string, mysql.RowDataPacket | null>();
  for (const row of rows) {
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    byName.set(name, byName.has(name) ? null : row);
  }
  const nodes = definition.nodes.map(node => {
    if (node.type !== "subflow") return node;
    const legacy = node.config.zlcxz && typeof node.config.zlcxz === "object" && !Array.isArray(node.config.zlcxz) ? node.config.zlcxz as Record<string, unknown> : {};
    const explicitId = String(node.config.subflowId ?? "").trim();
    const legacyId = String(legacy.id ?? "").trim();
    const legacyName = String(legacy.text ?? legacy.name ?? "").trim();
    const mapped = explicitId ? byId.get(explicitId) : byId.get(legacyId) ?? byName.get(legacyName) ?? undefined;
    if (explicitId && !mapped) throw new Error("流程只能引用流程所有者创建的私有子流程。");
    if (!mapped) {
      if (executable) throw new Error("原版子流程尚未映射到当前所有者已启用的私有子流程。");
      return node;
    }
    if (executable && !Boolean(mapped.isEnabled)) throw new Error("流程只能发布已启用的私有子流程引用。");
    return { ...node, config: { ...node.config, subflowId: String(mapped.id), zlcxz: Object.keys(legacy).length ? legacy : { id: String(mapped.id), text: String(mapped.name) } } };
  });
  return { ...definition, nodes };
}

export async function listWorkflows(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    user.role === "admin"
      ? "SELECT DISTINCT w.* FROM workflow w ORDER BY w.updatedAt DESC"
      : `SELECT DISTINCT w.* FROM workflow w
          LEFT JOIN workflow_member wm ON wm.workflowId=w.id AND wm.userId=? AND wm.revokedAt IS NULL AND wm.effectiveFrom<=NOW() AND (wm.expiresAt IS NULL OR wm.expiresAt>NOW())
          LEFT JOIN flow_project_member pm ON pm.projectId=w.projectId AND pm.userId=? AND pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW() AND (pm.expiresAt IS NULL OR pm.expiresAt>NOW())
          LEFT JOIN role_assignment ra ON ra.userId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW()) AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=w.id))
          LEFT JOIN role_permission rp ON rp.roleId=ra.roleId
          LEFT JOIN permission p ON p.id=rp.permissionId
         WHERE w.ownerUserId=? OR wm.id IS NOT NULL OR pm.id IS NOT NULL OR p.code='workflow:view'
         ORDER BY w.updatedAt DESC`,
    user.role === "admin" ? [] : [user.id, user.id, user.id, user.id],
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

export async function createWorkflow(user: WorkflowUser, name: string, description?: string, options?: { projectId?: string | null; folderId?: string | null; processCode?: string | null; flowType?: "state" | "control" | "data"; creationSource?: "manual" | "warehouse"; dataSourceId?: string | null; auditStatus?: "init" | "approved" | "rejected"; projectCreationAuthorized?: boolean }) {
  if (!options?.projectCreationAuthorized && !(await canCreateWorkflow(user))) throw new Error("当前账号没有创建流程的权限。");
  const workflowId = id();
  const definition = emptyDefinition();
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO workflow (id,ownerUserId,projectId,folderId,processCode,name,description,flowType,creationSource,dataSourceId,auditStatus,definitionJson,status,definitionVersion) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',1)",
      [workflowId, user.id, options?.projectId ?? null, options?.folderId ?? null, options?.processCode ?? null, name, description ?? null, options?.flowType ?? "state", options?.creationSource ?? "manual", options?.dataSourceId ?? null, options?.auditStatus ?? "approved", JSON.stringify(definition)],
    );
    await connection.query("INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)", [randomBytes(18).toString("hex"), workflowId, user.id, user.id]);
    await insertVersion(connection, { workflowId, version: 1, name, status: "draft", definition, source: "created", actorUserId: user.id });
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

export async function updateWorkflow(workflowId: string, user: WorkflowUser, values: { name?: string; definition?: unknown; publish?: boolean; unpublish?: boolean }) {
  if (values.publish && values.unpublish) throw new Error("发布和取消发布不能同时执行。 ");
  const permission: WorkflowPermission = values.publish || values.unpublish ? "workflow:publish" : "workflow:edit";
  if (!(await hasWorkflowPermission(user, workflowId, permission))) return null;
  const current = await getWorkflow(workflowId, user) as ({ ownerUserId: number; projectId?: string | null; auditStatus?: "init" | "approved" | "rejected"; name: string; status: "draft" | "published"; definitionVersion: number; definition: Definition } | null);
  if (!current) return null;
  const executable = Boolean(values.publish) || (current.status === "published" && !values.unpublish);
  const draftDefinition = values.definition === undefined ? current.definition : validate(values.definition, false);
  const definition = await resolveSubflowReferences(draftDefinition, current.ownerUserId, executable);
  if (executable) validate(definition, true);
  if (values.publish && current.projectId && (await isProjectApprovalRequired()) && current.auditStatus !== "approved") throw new Error("当前审批规则要求项目流程通过审核后才能发布。");
  const nextName = values.name ?? current.name;
  const nextStatus = values.unpublish ? "draft" : values.publish ? "published" : current.status;
  const nextVersion = Number(current.definitionVersion) + 1;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("UPDATE workflow SET name=?, definitionJson=?, status=?, definitionVersion=?, publishedAt=CASE WHEN ? THEN NOW() WHEN ? THEN NULL ELSE publishedAt END, unpublishedAt=CASE WHEN ? THEN NOW() ELSE unpublishedAt END, updatedAt=NOW() WHERE id=?", [nextName, JSON.stringify(definition), nextStatus, nextVersion, Boolean(values.publish), Boolean(values.unpublish), Boolean(values.unpublish), workflowId]);
    await insertVersion(connection, { workflowId, version: nextVersion, name: nextName, status: nextStatus, definition, source: values.unpublish ? "unpublished" : values.publish ? "published" : "updated", actorUserId: user.id });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (values.publish || values.unpublish) await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow", resourceId: workflowId, details: { operation: values.unpublish ? "workflow_unpublished" : "workflow_published", version: nextVersion, preservedRunHistory: true } });
  return getWorkflow(workflowId, user);
}

export async function listWorkflowVersions(workflowId: string, user: WorkflowUser) {
  if (!(await hasWorkflowPermission(user, workflowId, "workflow:view"))) return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT v.id,v.workflowId,v.version,v.name,v.status,v.changeSource,v.restoredFromVersion,v.createdByUserId,v.createdAt,u.username,u.name AS creatorName FROM workflow_version v LEFT JOIN users u ON u.id=v.createdByUserId WHERE v.workflowId=? ORDER BY v.version DESC LIMIT 100",
    [workflowId],
  );
  return rows;
}

export async function getWorkflowVersion(workflowId: string, version: number, user: WorkflowUser) {
  if (!(await hasWorkflowPermission(user, workflowId, "workflow:view"))) return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow_version WHERE workflowId=? AND version=? LIMIT 1", [workflowId, version]);
  const row = rows[0];
  return row ? { ...row, definition: parseJson(row.definitionJson) as Definition } : null;
}

export async function diffWorkflowVersions(workflowId: string, fromVersion: number, toVersion: number, user: WorkflowUser) {
  const [from, to] = await Promise.all([getWorkflowVersion(workflowId, fromVersion, user), getWorkflowVersion(workflowId, toVersion, user)]);
  if (!from || !to) return null;
  const fromNodes = new Map(from.definition.nodes.map(node => [node.id, node]));
  const toNodes = new Map(to.definition.nodes.map(node => [node.id, node]));
  const addedNodes = to.definition.nodes.filter(node => !fromNodes.has(node.id)).map(node => ({ id: node.id, name: node.name, type: node.type }));
  const removedNodes = from.definition.nodes.filter(node => !toNodes.has(node.id)).map(node => ({ id: node.id, name: node.name, type: node.type }));
  const changedNodes = to.definition.nodes.flatMap(node => {
    const previous = fromNodes.get(node.id);
    if (!previous) return [];
    const changedFields = ["name", "type", "position", "config"].filter(field => JSON.stringify(previous[field as keyof Node]) !== JSON.stringify(node[field as keyof Node]));
    return changedFields.length ? [{ id: node.id, name: node.name, changedFields }] : [];
  });
  const edgeKey = (edge: Edge) => `${edge.sourceNodeId}|${edge.sourceHandle ?? "default"}|${edge.targetNodeId}`;
  const fromEdges = new Set(from.definition.edges.map(edgeKey));
  const toEdges = new Set(to.definition.edges.map(edgeKey));
  return { fromVersion, toVersion, addedNodes, removedNodes, changedNodes, addedEdges: to.definition.edges.filter(edge => !fromEdges.has(edgeKey(edge))), removedEdges: from.definition.edges.filter(edge => !toEdges.has(edgeKey(edge))), summary: { nodes: `${from.definition.nodes.length} → ${to.definition.nodes.length}`, edges: `${from.definition.edges.length} → ${to.definition.edges.length}` } };
}

export async function rollbackWorkflowVersion(workflowId: string, targetVersion: number, user: WorkflowUser) {
  if (!(await hasWorkflowPermission(user, workflowId, "workflow:edit"))) return null;
  const target = await getWorkflowVersion(workflowId, targetVersion, user) as ({ name: string; status: "draft" | "published"; definition: Definition } | null);
  if (!target) return null;
  if (target.status === "published" && !(await hasWorkflowPermission(user, workflowId, "workflow:publish"))) throw new Error("恢复已发布版本需要发布权限。");
  const current = await getWorkflow(workflowId, user) as ({ name: string; definitionVersion: number } | null);
  if (!current) return null;
  const nextVersion = Number(current.definitionVersion) + 1;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("UPDATE workflow SET name=?,definitionJson=?,status=?,definitionVersion=?,updatedAt=NOW() WHERE id=?", [target.name, JSON.stringify(target.definition), target.status, nextVersion, workflowId]);
    await insertVersion(connection, { workflowId, version: nextVersion, name: target.name, status: target.status, definition: target.definition, source: "rolled_back", actorUserId: user.id, restoredFromVersion: targetVersion });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow", resourceId: workflowId, details: { operation: "version_rolled_back", restoredFromVersion: targetVersion, createdVersion: nextVersion } });
  return getWorkflow(workflowId, user);
}

export async function listNodeTemplates(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow_node_template WHERE ownerUserId=? ORDER BY updatedAt DESC LIMIT 100", [user.id]);
  return rows.map(row => ({ ...row, config: parseJson(row.configJson) }));
}

export async function createNodeTemplate(user: WorkflowUser, input: { name: string; description?: string; nodeType: TemplateNodeType; config: unknown }) {
  if (!templateNodeTypes.has(input.nodeType)) throw new Error("该节点类型不能保存为模板。");
  const config = assertJsonObject(input.config, "节点模板配置必须是 JSON 对象。");
  const templateId = id();
  await db().query("INSERT INTO workflow_node_template (id,ownerUserId,name,description,nodeType,configJson) VALUES (?,?,?,?,?,?)", [templateId, user.id, input.name.trim(), input.description?.trim() || null, input.nodeType, JSON.stringify(config)]);
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow_node_template", resourceId: templateId, details: { operation: "template_created", nodeType: input.nodeType } });
  return templateId;
}

export async function updateNodeTemplate(user: WorkflowUser, input: { id: string; name?: string; description?: string | null; config?: unknown }) {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow_node_template WHERE id=? AND ownerUserId=? LIMIT 1", [input.id, user.id]);
  const template = rows[0];
  if (!template) return false;
  const name = input.name?.trim() || template.name;
  const description = input.description === undefined ? template.description : input.description?.trim() || null;
  const config = input.config === undefined ? parseJson(template.configJson) : assertJsonObject(input.config, "节点模板配置必须是 JSON 对象。");
  await db().query("UPDATE workflow_node_template SET name=?,description=?,configJson=?,updatedAt=NOW() WHERE id=? AND ownerUserId=?", [name, description, JSON.stringify(config), input.id, user.id]);
  return true;
}

export async function deleteNodeTemplate(user: WorkflowUser, templateId: string) {
  const [result] = await db().query<mysql.ResultSetHeader>("DELETE FROM workflow_node_template WHERE id=? AND ownerUserId=?", [templateId, user.id]);
  return Boolean(result.affectedRows);
}

export async function listSubflows(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow_subflow WHERE ownerUserId=? ORDER BY updatedAt DESC LIMIT 100", [user.id]);
  return rows.map(row => ({ ...row, definition: parseJson(row.definitionJson) }));
}

export async function createSubflow(user: WorkflowUser, input: { name: string; description?: string; definition: unknown }) {
  const definition = validate(input.definition, true);
  if (definition.nodes.some(node => node.type === "subflow")) throw new Error("子流程暂不支持嵌套子流程调用。");
  const subflowId = id();
  await db().query("INSERT INTO workflow_subflow (id,ownerUserId,name,description,definitionJson,isEnabled) VALUES (?,?,?,?,?,1)", [subflowId, user.id, input.name.trim(), input.description?.trim() || null, JSON.stringify(definition)]);
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "workflow_subflow", resourceId: subflowId, details: { operation: "subflow_created" } });
  return subflowId;
}

export async function updateSubflow(user: WorkflowUser, input: { id: string; name?: string; description?: string | null; definition?: unknown; isEnabled?: boolean }) {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow_subflow WHERE id=? AND ownerUserId=? LIMIT 1", [input.id, user.id]);
  const subflow = rows[0];
  if (!subflow) return false;
  const definition = input.definition === undefined ? parseJson(subflow.definitionJson) as Definition : validate(input.definition, true);
  if (definition.nodes.some(node => node.type === "subflow")) throw new Error("子流程暂不支持嵌套子流程调用。");
  await db().query("UPDATE workflow_subflow SET name=?,description=?,definitionJson=?,isEnabled=?,updatedAt=NOW() WHERE id=? AND ownerUserId=?", [input.name?.trim() || subflow.name, input.description === undefined ? subflow.description : input.description?.trim() || null, JSON.stringify(definition), input.isEnabled === undefined ? subflow.isEnabled : input.isEnabled, input.id, user.id]);
  return true;
}

export async function deleteSubflow(user: WorkflowUser, subflowId: string) {
  const [result] = await db().query<mysql.ResultSetHeader>("DELETE FROM workflow_subflow WHERE id=? AND ownerUserId=?", [subflowId, user.id]);
  return Boolean(result.affectedRows);
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
    const [runRows] = await connection.query<mysql.RowDataPacket[]>("SELECT id FROM workflow_run WHERE workflowId=? LIMIT 1 FOR UPDATE", [workflowId]);
    if (runRows.length) throw new Error("流程已有运行历史，禁止物理删除；请取消发布并保留任务、运行和审计记录。");
    await connection.query("DELETE FROM workflow_run_alert WHERE workflowId=?", [workflowId]);
    await connection.query("DELETE FROM workflow_task WHERE workflowId=?", [workflowId]);
    await connection.query("DELETE FROM workflow_participant_state WHERE workflowId=?", [workflowId]);
    await connection.query("DELETE FROM workflow_task_group WHERE workflowId=?", [workflowId]);
    await connection.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?", [workflowId]);
    await connection.query("DELETE FROM workflow_run WHERE workflowId=?", [workflowId]);
    await connection.query("DELETE FROM workflow_version WHERE workflowId=?", [workflowId]);
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
