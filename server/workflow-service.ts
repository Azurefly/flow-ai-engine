import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import {
  getWorkflowAccess,
  hasSystemPermission,
  recordAuthorizationAudit,
  type WorkflowPermission,
} from "./iam-service";
import { isProjectApprovalRequired } from "./p1-service";
import {
  analyzeWorkflowDefinition,
  compileWorkflowDefinition,
  validateWorkflowDefinition,
  type WorkflowCompileResult,
  type WorkflowCompileDiagnostic,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from "./workflow-compiler";

type Node = WorkflowNode;
type Edge = WorkflowEdge;
export type Definition = WorkflowDefinition;
const id = () => randomBytes(12).toString("base64url");
let pool: mysql.Pool | undefined;
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
};
export const emptyDefinition = (): Definition => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      position: { x: 90, y: 180 },
      config: { initialVariables: {} },
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      position: { x: 430, y: 180 },
      config: { resultTemplate: "{{result}}" },
    },
  ],
  edges: [
    {
      id: "start-end",
      sourceNodeId: "start",
      sourceHandle: "default",
      targetNodeId: "end",
    },
  ],
});
export function validate(definition: unknown, executable = false): Definition {
  return validateWorkflowDefinition(definition, executable);
}
type WorkflowUser = { id: number; role: "user" | "admin" };
type VersionSource =
  | "created"
  | "updated"
  | "published"
  | "unpublished"
  | "rolled_back";
type TemplateNodeType = Exclude<Node["type"], "start" | "end" | "subflow">;

const templateNodeTypes = new Set<TemplateNodeType>([
  "llm",
  "http",
  "transform",
  "condition",
]);

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function assertJsonObject(value: unknown, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(message);
  return value as Record<string, unknown>;
}

function hydrateWorkflow(row: mysql.RowDataPacket) {
  const definition = parseJson(row.definitionJson);
  return { ...row, definition };
}

async function insertVersion(
  connection: mysql.PoolConnection,
  input: {
    workflowId: string;
    version: number;
    name: string;
    status: "draft" | "published";
    definition: Definition;
    source: VersionSource;
    actorUserId: number;
    restoredFromVersion?: number | null;
    executionPlan?: unknown;
    executionPlanHash?: string | null;
  }
) {
  await connection.query(
    "INSERT INTO workflow_version (id,workflowId,version,name,status,definitionJson,executionPlanJson,executionPlanHash,changeSource,restoredFromVersion,createdByUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id(),
      input.workflowId,
      input.version,
      input.name,
      input.status,
      JSON.stringify(input.definition),
      input.executionPlan === undefined ? null : JSON.stringify(input.executionPlan),
      input.executionPlanHash ?? null,
      input.source,
      input.restoredFromVersion ?? null,
      input.actorUserId,
    ]
  );
}

async function resolveSubflowReferences(
  definition: Definition,
  ownerUserId: number,
  executable: boolean
) {
  const subflowNodes = definition.nodes.filter(node => node.type === "subflow");
  if (!subflowNodes.length) return definition;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,name,isEnabled FROM workflow_subflow WHERE ownerUserId=?",
    [ownerUserId]
  );
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const byName = new Map<string, mysql.RowDataPacket | null>();
  for (const row of rows) {
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    byName.set(name, byName.has(name) ? null : row);
  }
  const nodes = definition.nodes.map(node => {
    if (node.type !== "subflow") return node;
    const legacy =
      node.config.zlcxz &&
      typeof node.config.zlcxz === "object" &&
      !Array.isArray(node.config.zlcxz)
        ? (node.config.zlcxz as Record<string, unknown>)
        : {};
    const explicitId = String(node.config.subflowId ?? "").trim();
    const legacyId = String(legacy.id ?? "").trim();
    const legacyName = String(legacy.text ?? legacy.name ?? "").trim();
    const mapped = explicitId
      ? byId.get(explicitId)
      : (byId.get(legacyId) ?? byName.get(legacyName) ?? undefined);
    if (explicitId && !mapped)
      throw new Error("流程只能引用流程所有者创建的私有子流程。");
    if (!mapped) {
      if (executable)
        throw new Error("原版子流程尚未映射到当前所有者已启用的私有子流程。");
      return node;
    }
    if (executable && !Boolean(mapped.isEnabled))
      throw new Error("流程只能发布已启用的私有子流程引用。");
    return {
      ...node,
      config: {
        ...node.config,
        subflowId: String(mapped.id),
        zlcxz: Object.keys(legacy).length
          ? legacy
          : { id: String(mapped.id), text: String(mapped.name) },
      },
    };
  });
  return { ...definition, nodes };
}

export async function listWorkflows(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    user.role === "admin"
      ? "SELECT DISTINCT w.* FROM workflow w WHERE w.archivedAt IS NULL ORDER BY w.updatedAt DESC"
      : `SELECT DISTINCT w.* FROM workflow w
          LEFT JOIN workflow_member wm ON wm.workflowId=w.id AND wm.userId=? AND wm.revokedAt IS NULL AND wm.effectiveFrom<=NOW() AND (wm.expiresAt IS NULL OR wm.expiresAt>NOW())
          LEFT JOIN flow_project_member pm ON pm.projectId=w.projectId AND pm.userId=? AND pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW() AND (pm.expiresAt IS NULL OR pm.expiresAt>NOW())
          LEFT JOIN role_assignment ra ON ra.userId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW()) AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=w.id))
          LEFT JOIN role_permission rp ON rp.roleId=ra.roleId
          LEFT JOIN permission p ON p.id=rp.permissionId
         WHERE w.archivedAt IS NULL AND (w.ownerUserId=? OR wm.id IS NOT NULL OR pm.id IS NOT NULL OR p.code='workflow:view')
         ORDER BY w.updatedAt DESC`,
    user.role === "admin" ? [] : [user.id, user.id, user.id, user.id]
  );
  return rows.map(hydrateWorkflow);
}

export async function listArchivedWorkflows(
  user: WorkflowUser,
  projectId: string
) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    user.role === "admin"
      ? "SELECT DISTINCT w.* FROM workflow w WHERE w.projectId=? AND w.archivedAt IS NOT NULL ORDER BY w.archivedAt DESC"
      : `SELECT DISTINCT w.* FROM workflow w
          LEFT JOIN workflow_member wm ON wm.workflowId=w.id AND wm.userId=? AND wm.revokedAt IS NULL AND wm.effectiveFrom<=NOW() AND (wm.expiresAt IS NULL OR wm.expiresAt>NOW())
          LEFT JOIN flow_project_member pm ON pm.projectId=w.projectId AND pm.userId=? AND pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW() AND (pm.expiresAt IS NULL OR pm.expiresAt>NOW())
          LEFT JOIN role_assignment ra ON ra.userId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW()) AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=w.id))
          LEFT JOIN role_permission rp ON rp.roleId=ra.roleId
          LEFT JOIN permission p ON p.id=rp.permissionId
         WHERE w.projectId=? AND w.archivedAt IS NOT NULL AND (w.ownerUserId=? OR wm.id IS NOT NULL OR pm.id IS NOT NULL OR p.code IN ('workflow:view','workflow:edit','workflow:publish','workflow:run','workflow:members:manage'))
         ORDER BY w.archivedAt DESC`,
    user.role === "admin"
      ? [projectId]
      : [user.id, user.id, user.id, projectId, user.id]
  );
  if (user.role === "admin")
    return rows.map(row => ({ ...hydrateWorkflow(row), canRestore: true }));
  if (!rows.length) return [];
  const workflowIds = rows.map(row => String(row.id));
  const [manageableRows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT w.id FROM workflow w
      LEFT JOIN workflow_member wm ON wm.workflowId=w.id AND wm.userId=? AND wm.role='owner' AND wm.revokedAt IS NULL AND wm.effectiveFrom<=NOW() AND (wm.expiresAt IS NULL OR wm.expiresAt>NOW())
      LEFT JOIN flow_project_member pm ON pm.projectId=w.projectId AND pm.userId=? AND pm.role='owner' AND pm.revokedAt IS NULL AND pm.effectiveFrom<=NOW() AND (pm.expiresAt IS NULL OR pm.expiresAt>NOW())
      LEFT JOIN role_assignment ra ON ra.userId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW()) AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=w.id))
      LEFT JOIN role_permission rp ON rp.roleId=ra.roleId
      LEFT JOIN permission p ON p.id=rp.permissionId AND p.code='workflow:members:manage'
     WHERE w.id IN (?) AND (w.ownerUserId=? OR wm.id IS NOT NULL OR pm.id IS NOT NULL OR p.id IS NOT NULL)`,
    [user.id, user.id, user.id, workflowIds, user.id]
  );
  const manageableIds = new Set(manageableRows.map(row => String(row.id)));
  return rows.map(row => ({
    ...hydrateWorkflow(row),
    canRestore: manageableIds.has(String(row.id)),
  }));
}

export async function getWorkflow(idValue: string, user: WorkflowUser) {
  if (
    !(await getWorkflowAccess(user, idValue)).permissions.has("workflow:view")
  )
    return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow WHERE id=? LIMIT 1",
    [idValue]
  );
  const row = rows[0];
  return row ? hydrateWorkflow(row) : null;
}

export async function canCreateWorkflow(user: WorkflowUser) {
  return hasSystemPermission(user, "workflow:create");
}

export async function createWorkflow(
  user: WorkflowUser,
  name: string,
  description?: string,
  options?: {
    projectId?: string | null;
    folderId?: string | null;
    processCode?: string | null;
    flowType?: "state" | "control" | "data";
    creationSource?: "manual" | "warehouse";
    dataSourceId?: string | null;
    auditStatus?: "init" | "approved" | "rejected";
    projectCreationAuthorized?: boolean;
  }
) {
  if (!options?.projectCreationAuthorized && !(await canCreateWorkflow(user)))
    throw new Error("当前账号没有创建流程的权限。");
  const workflowId = id();
  const definition = emptyDefinition();
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO workflow (id,ownerUserId,projectId,folderId,processCode,name,description,flowType,creationSource,dataSourceId,auditStatus,definitionJson,status,definitionVersion) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',1)",
      [
        workflowId,
        user.id,
        options?.projectId ?? null,
        options?.folderId ?? null,
        options?.processCode ?? null,
        name,
        description ?? null,
        options?.flowType ?? "state",
        options?.creationSource ?? "manual",
        options?.dataSourceId ?? null,
        options?.auditStatus ?? "approved",
        JSON.stringify(definition),
      ]
    );
    await connection.query(
      "INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)",
      [randomBytes(18).toString("hex"), workflowId, user.id, user.id]
    );
    await insertVersion(connection, {
      workflowId,
      version: 1,
      name,
      status: "draft",
      definition,
      source: "created",
      actorUserId: user.id,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getWorkflow(workflowId, user);
}

export async function hasWorkflowPermission(
  user: WorkflowUser,
  workflowId: string,
  permission: WorkflowPermission
) {
  return (await getWorkflowAccess(user, workflowId)).permissions.has(
    permission
  );
}

export async function updateWorkflow(
  workflowId: string,
  user: WorkflowUser,
  values: {
    name?: string;
    definition?: unknown;
    publish?: boolean;
    unpublish?: boolean;
  }
) {
  if (values.publish && values.unpublish)
    throw new Error("发布和取消发布不能同时执行。 ");
  const permission: WorkflowPermission =
    values.publish || values.unpublish ? "workflow:publish" : "workflow:edit";
  if (!(await hasWorkflowPermission(user, workflowId, permission))) return null;
  const current = (await getWorkflow(workflowId, user)) as {
    ownerUserId: number;
    projectId?: string | null;
    auditStatus?: "init" | "approved" | "rejected";
    archivedAt?: Date | string | null;
    name: string;
    status: "draft" | "published";
    definitionVersion: number;
    definition: Definition;
  } | null;
  if (!current) return null;
  if (current.archivedAt)
    throw new Error("已归档流程必须先恢复后才能编辑或发布。");
  const executable =
    Boolean(values.publish) ||
    (current.status === "published" && !values.unpublish);
  const draftDefinition =
    values.definition === undefined
      ? current.definition
      : validate(values.definition, false);
  const definition = await resolveSubflowReferences(
    draftDefinition,
    current.ownerUserId,
    executable
  );
  const compiled = executable ? compileWorkflowDefinition(definition) : null;
  const persistedDefinition = compiled?.definition ?? definition;
  if (
    values.publish &&
    current.projectId &&
    (await isProjectApprovalRequired()) &&
    current.auditStatus !== "approved"
  )
    throw new Error("当前审批规则要求项目流程通过审核后才能发布。");
  const nextName = values.name ?? current.name;
  const nextStatus = values.unpublish
    ? "draft"
    : values.publish
      ? "published"
      : current.status;
  const nextVersion = Number(current.definitionVersion) + 1;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE workflow SET name=?, definitionJson=?, status=?, definitionVersion=?, publishedExecutionPlanJson=?, publishedExecutionPlanHash=?, publishedAt=CASE WHEN ? THEN NOW() WHEN ? THEN NULL ELSE publishedAt END, unpublishedAt=CASE WHEN ? THEN NOW() ELSE unpublishedAt END, updatedAt=NOW() WHERE id=?",
      [
        nextName,
        JSON.stringify(persistedDefinition),
        nextStatus,
        nextVersion,
        values.unpublish
          ? null
          : compiled
            ? JSON.stringify(compiled.plan)
            : null,
        values.unpublish ? null : compiled?.planHash ?? null,
        Boolean(values.publish),
        Boolean(values.unpublish),
        Boolean(values.unpublish),
        workflowId,
      ]
    );
    await insertVersion(connection, {
      workflowId,
      version: nextVersion,
      name: nextName,
      status: nextStatus,
      definition: persistedDefinition,
      source: values.unpublish
        ? "unpublished"
        : values.publish
          ? "published"
          : "updated",
      actorUserId: user.id,
      executionPlan: compiled?.plan,
      executionPlanHash: compiled?.planHash,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (values.publish || values.unpublish)
    await recordAuthorizationAudit({
      actorUserId: user.id,
      action: "user_updated",
      resourceType: "workflow",
      resourceId: workflowId,
      details: {
        operation: values.unpublish
          ? "workflow_unpublished"
          : "workflow_published",
        version: nextVersion,
        preservedRunHistory: true,
      },
    });
  return getWorkflow(workflowId, user);
}

export async function compileWorkflowDraft(
  workflowId: string,
  user: WorkflowUser,
  candidateDefinition?: unknown
): Promise<WorkflowCompileResult | null> {
  if (!(await hasWorkflowPermission(user, workflowId, "workflow:publish")))
    return null;
  const current = (await getWorkflow(workflowId, user)) as {
    ownerUserId: number;
    archivedAt?: Date | string | null;
    definition: Definition;
  } | null;
  if (!current) return null;
  if (current.archivedAt)
    throw new Error("已归档流程必须先恢复后才能编译发布。 ");
  const draft = candidateDefinition ?? current.definition;
  const structural = analyzeWorkflowDefinition(draft, { executable: true });
  if (!structural.ok) return structural;
  try {
    const resolved = await resolveSubflowReferences(
      structural.definition,
      current.ownerUserId,
      true
    );
    return compileWorkflowDefinition(resolved);
  } catch (error) {
    if (error && typeof error === "object" && "diagnostics" in error)
      return {
        ok: false,
        diagnostics: (error as { diagnostics: WorkflowCompileDiagnostic[] }).diagnostics,
      };
    throw error;
  }
}

export async function listWorkflowVersions(
  workflowId: string,
  user: WorkflowUser
) {
  if (!(await hasWorkflowPermission(user, workflowId, "workflow:view")))
    return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT v.id,v.workflowId,v.version,v.name,v.status,v.changeSource,v.restoredFromVersion,v.createdByUserId,v.createdAt,u.username,u.name AS creatorName FROM workflow_version v LEFT JOIN users u ON u.id=v.createdByUserId WHERE v.workflowId=? ORDER BY v.version DESC LIMIT 100",
    [workflowId]
  );
  return rows;
}

export async function getWorkflowVersion(
  workflowId: string,
  version: number,
  user: WorkflowUser
) {
  if (!(await hasWorkflowPermission(user, workflowId, "workflow:view")))
    return null;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_version WHERE workflowId=? AND version=? LIMIT 1",
    [workflowId, version]
  );
  const row = rows[0];
  return row
    ? { ...row, definition: parseJson(row.definitionJson) as Definition }
    : null;
}

export async function diffWorkflowVersions(
  workflowId: string,
  fromVersion: number,
  toVersion: number,
  user: WorkflowUser
) {
  const [from, to] = await Promise.all([
    getWorkflowVersion(workflowId, fromVersion, user),
    getWorkflowVersion(workflowId, toVersion, user),
  ]);
  if (!from || !to) return null;
  const fromNodes = new Map(from.definition.nodes.map(node => [node.id, node]));
  const toNodes = new Map(to.definition.nodes.map(node => [node.id, node]));
  const addedNodes = to.definition.nodes
    .filter(node => !fromNodes.has(node.id))
    .map(node => ({ id: node.id, name: node.name, type: node.type }));
  const removedNodes = from.definition.nodes
    .filter(node => !toNodes.has(node.id))
    .map(node => ({ id: node.id, name: node.name, type: node.type }));
  const changedNodes = to.definition.nodes.flatMap(node => {
    const previous = fromNodes.get(node.id);
    if (!previous) return [];
    const changedFields = ["name", "type", "position", "config"].filter(
      field =>
        JSON.stringify(previous[field as keyof Node]) !==
        JSON.stringify(node[field as keyof Node])
    );
    return changedFields.length
      ? [{ id: node.id, name: node.name, changedFields }]
      : [];
  });
  const edgeKey = (edge: Edge) =>
    `${edge.sourceNodeId}|${edge.sourceHandle ?? "default"}|${edge.targetNodeId}`;
  const fromEdges = new Set(from.definition.edges.map(edgeKey));
  const toEdges = new Set(to.definition.edges.map(edgeKey));
  return {
    fromVersion,
    toVersion,
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges: to.definition.edges.filter(
      edge => !fromEdges.has(edgeKey(edge))
    ),
    removedEdges: from.definition.edges.filter(
      edge => !toEdges.has(edgeKey(edge))
    ),
    summary: {
      nodes: `${from.definition.nodes.length} → ${to.definition.nodes.length}`,
      edges: `${from.definition.edges.length} → ${to.definition.edges.length}`,
    },
  };
}

export async function rollbackWorkflowVersion(
  workflowId: string,
  targetVersion: number,
  user: WorkflowUser
) {
  if (!(await hasWorkflowPermission(user, workflowId, "workflow:edit")))
    return null;
  const target = (await getWorkflowVersion(
    workflowId,
    targetVersion,
    user
  )) as {
    name: string;
    status: "draft" | "published";
    definition: Definition;
  } | null;
  if (!target) return null;
  if (
    target.status === "published" &&
    !(await hasWorkflowPermission(user, workflowId, "workflow:publish"))
  )
    throw new Error("恢复已发布版本需要发布权限。");
  const current = (await getWorkflow(workflowId, user)) as {
    name: string;
    definitionVersion: number;
  } | null;
  if (!current) return null;
  const nextVersion = Number(current.definitionVersion) + 1;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE workflow SET name=?,definitionJson=?,status=?,definitionVersion=?,updatedAt=NOW() WHERE id=?",
      [
        target.name,
        JSON.stringify(target.definition),
        target.status,
        nextVersion,
        workflowId,
      ]
    );
    await insertVersion(connection, {
      workflowId,
      version: nextVersion,
      name: target.name,
      status: target.status,
      definition: target.definition,
      source: "rolled_back",
      actorUserId: user.id,
      restoredFromVersion: targetVersion,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow",
    resourceId: workflowId,
    details: {
      operation: "version_rolled_back",
      restoredFromVersion: targetVersion,
      createdVersion: nextVersion,
    },
  });
  return getWorkflow(workflowId, user);
}

export async function listNodeTemplates(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_node_template WHERE ownerUserId=? ORDER BY updatedAt DESC LIMIT 100",
    [user.id]
  );
  return rows.map(row => ({ ...row, config: parseJson(row.configJson) }));
}

export async function createNodeTemplate(
  user: WorkflowUser,
  input: {
    name: string;
    description?: string;
    nodeType: TemplateNodeType;
    config: unknown;
  }
) {
  if (!templateNodeTypes.has(input.nodeType))
    throw new Error("该节点类型不能保存为模板。");
  const config = assertJsonObject(
    input.config,
    "节点模板配置必须是 JSON 对象。"
  );
  const templateId = id();
  await db().query(
    "INSERT INTO workflow_node_template (id,ownerUserId,name,description,nodeType,configJson) VALUES (?,?,?,?,?,?)",
    [
      templateId,
      user.id,
      input.name.trim(),
      input.description?.trim() || null,
      input.nodeType,
      JSON.stringify(config),
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow_node_template",
    resourceId: templateId,
    details: { operation: "template_created", nodeType: input.nodeType },
  });
  return templateId;
}

export async function updateNodeTemplate(
  user: WorkflowUser,
  input: {
    id: string;
    name?: string;
    description?: string | null;
    config?: unknown;
  }
) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_node_template WHERE id=? AND ownerUserId=? LIMIT 1",
    [input.id, user.id]
  );
  const template = rows[0];
  if (!template) return false;
  const name = input.name?.trim() || template.name;
  const description =
    input.description === undefined
      ? template.description
      : input.description?.trim() || null;
  const config =
    input.config === undefined
      ? parseJson(template.configJson)
      : assertJsonObject(input.config, "节点模板配置必须是 JSON 对象。");
  await db().query(
    "UPDATE workflow_node_template SET name=?,description=?,configJson=?,updatedAt=NOW() WHERE id=? AND ownerUserId=?",
    [name, description, JSON.stringify(config), input.id, user.id]
  );
  return true;
}

export async function deleteNodeTemplate(
  user: WorkflowUser,
  templateId: string
) {
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM workflow_node_template WHERE id=? AND ownerUserId=?",
    [templateId, user.id]
  );
  return Boolean(result.affectedRows);
}

export async function listSubflows(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_subflow WHERE ownerUserId=? ORDER BY updatedAt DESC LIMIT 100",
    [user.id]
  );
  return rows.map(row => ({
    ...row,
    definition: parseJson(row.definitionJson),
  }));
}

export async function createSubflow(
  user: WorkflowUser,
  input: { name: string; description?: string; definition: unknown }
) {
  const definition = validate(input.definition, true);
  if (definition.nodes.some(node => node.type === "subflow"))
    throw new Error("子流程暂不支持嵌套子流程调用。");
  const subflowId = id();
  await db().query(
    "INSERT INTO workflow_subflow (id,ownerUserId,name,description,definitionJson,isEnabled) VALUES (?,?,?,?,?,1)",
    [
      subflowId,
      user.id,
      input.name.trim(),
      input.description?.trim() || null,
      JSON.stringify(definition),
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow_subflow",
    resourceId: subflowId,
    details: { operation: "subflow_created" },
  });
  return subflowId;
}

export async function updateSubflow(
  user: WorkflowUser,
  input: {
    id: string;
    name?: string;
    description?: string | null;
    definition?: unknown;
    isEnabled?: boolean;
  }
) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_subflow WHERE id=? AND ownerUserId=? LIMIT 1",
    [input.id, user.id]
  );
  const subflow = rows[0];
  if (!subflow) return false;
  const definition =
    input.definition === undefined
      ? (parseJson(subflow.definitionJson) as Definition)
      : validate(input.definition, true);
  if (definition.nodes.some(node => node.type === "subflow"))
    throw new Error("子流程暂不支持嵌套子流程调用。");
  await db().query(
    "UPDATE workflow_subflow SET name=?,description=?,definitionJson=?,isEnabled=?,updatedAt=NOW() WHERE id=? AND ownerUserId=?",
    [
      input.name?.trim() || subflow.name,
      input.description === undefined
        ? subflow.description
        : input.description?.trim() || null,
      JSON.stringify(definition),
      input.isEnabled === undefined ? subflow.isEnabled : input.isEnabled,
      input.id,
      user.id,
    ]
  );
  return true;
}

export async function deleteSubflow(user: WorkflowUser, subflowId: string) {
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM workflow_subflow WHERE id=? AND ownerUserId=?",
    [subflowId, user.id]
  );
  return Boolean(result.affectedRows);
}

export async function duplicateWorkflow(
  workflowId: string,
  user: WorkflowUser,
  name?: string
) {
  const source = (await getWorkflow(workflowId, user)) as {
    name: string;
    description?: string | null;
    definition: Definition;
  } | null;
  if (!source) return null;
  const duplicated = await createWorkflow(
    user,
    name?.trim() || `${source.name} · 副本`,
    source.description ?? undefined
  );
  if (!duplicated) return null;
  return updateWorkflow((duplicated as any).id, user, {
    definition: source.definition,
  });
}

export async function deleteWorkflow(workflowId: string, user: WorkflowUser) {
  if (
    !(await hasWorkflowPermission(user, workflowId, "workflow:members:manage"))
  )
    return false;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [runRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_run WHERE workflowId=? LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    if (runRows.length)
      throw new Error(
        "流程已有运行历史，禁止物理删除；请取消发布并保留任务、运行和审计记录。"
      );
    await connection.query(
      "DELETE FROM workflow_run_alert WHERE workflowId=?",
      [workflowId]
    );
    await connection.query("DELETE FROM workflow_task WHERE workflowId=?", [
      workflowId,
    ]);
    await connection.query(
      "DELETE FROM workflow_participant_state WHERE workflowId=?",
      [workflowId]
    );
    await connection.query(
      "DELETE FROM workflow_task_group WHERE workflowId=?",
      [workflowId]
    );
    await connection.query(
      "DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?",
      [workflowId]
    );
    await connection.query("DELETE FROM workflow_run WHERE workflowId=?", [
      workflowId,
    ]);
    await connection.query("DELETE FROM workflow_version WHERE workflowId=?", [
      workflowId,
    ]);
    await connection.query("DELETE FROM workflow_member WHERE workflowId=?", [
      workflowId,
    ]);
    await connection.query(
      "UPDATE role_assignment SET revokedAt=NOW(),revokedByUserId=? WHERE scopeType='workflow' AND scopeId=? AND revokedAt IS NULL",
      [user.id, workflowId]
    );
    const [result] = await connection.query<mysql.ResultSetHeader>(
      "DELETE FROM workflow WHERE id=?",
      [workflowId]
    );
    if (!result.affectedRows) throw new Error("流程不存在或已被删除。");
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow",
    resourceId: workflowId,
    details: { operation: "workflow_deleted" },
  });
  return true;
}

export async function archiveWorkflow(workflowId: string, user: WorkflowUser) {
  if (
    !(await hasWorkflowPermission(user, workflowId, "workflow:members:manage"))
  )
    return false;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [workflowRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,archivedAt FROM workflow WHERE id=? LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    if (!workflowRows[0]) throw new Error("流程不存在。");
    if (workflowRows[0].archivedAt) {
      await connection.commit();
      return true;
    }
    const [activeRuns] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_run WHERE workflowId=? AND status IN ('queued','running') LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    if (activeRuns.length)
      throw new Error(
        "流程存在排队中或运行中的实例，禁止归档；请先完成或取消活动运行。"
      );
    const [activeDataflowRuns] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM dataflow_run WHERE workflowId=? AND status IN ('queued','running') LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    if (activeDataflowRuns.length)
      throw new Error(
        "数据流程存在排队中或运行中的实例，禁止归档；请等待活动运行结束。"
      );
    const [activeSchedules] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM dataflow_schedule WHERE workflowId=? AND status='active' LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    if (activeSchedules.length)
      throw new Error("数据流程仍有启用中的调度，请先暂停调度后再归档。");
    await connection.query(
      "UPDATE workflow SET archivedAt=NOW(),archivedByUserId=?,status='draft',unpublishedAt=NOW(),updatedAt=NOW() WHERE id=?",
      [user.id, workflowId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow",
    resourceId: workflowId,
    details: { operation: "workflow_archived", recoverable: true },
  });
  return true;
}

export async function restoreWorkflow(workflowId: string, user: WorkflowUser) {
  if (
    !(await hasWorkflowPermission(user, workflowId, "workflow:members:manage"))
  )
    return false;
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow SET archivedAt=NULL,archivedByUserId=NULL,updatedAt=NOW() WHERE id=? AND archivedAt IS NOT NULL",
    [workflowId]
  );
  if (!result.affectedRows) return false;
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow",
    resourceId: workflowId,
    details: { operation: "workflow_restored" },
  });
  return true;
}
