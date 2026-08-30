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
  type WorkflowAnalysisOptions,
  type WorkflowEdge,
  type WorkflowNode,
} from "./workflow-compiler";

type Node = WorkflowNode;
type Edge = WorkflowEdge;
export type Definition = WorkflowDefinition;

export function assertProjectServiceTaskReferences(definition: Definition) {
  for (const node of definition.nodes) {
    if (!(["http", "rest", "method"] as string[]).includes(node.type)) continue;
    const endpointRef = String(node.config.endpointRef ?? "").trim();
    if (!endpointRef)
      throw new Error(
        `项目流程服务节点“${node.name}”必须配置项目 EndpointRef，不能直接调用任意地址。`
      );
    const rawUrl = String(
      node.type === "http"
        ? node.config.url ?? ""
        : node.config.restApi ?? node.config.endpoint ?? node.config.url ?? ""
    ).trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) || rawUrl.startsWith("//"))
      throw new Error(
        `项目流程服务节点“${node.name}”使用 EndpointRef 时只能配置相对路径。`
      );
  }
}
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
export function validate(
  definition: unknown,
  options: WorkflowAnalysisOptions
): Definition {
  return validateWorkflowDefinition(definition, options);
}
export function assertWorkflowUpdateTransition(
  currentStatus: "draft" | "published",
  values: { definition?: unknown; publish?: boolean; unpublish?: boolean }
) {
  if (
    currentStatus === "published" &&
    values.definition !== undefined &&
    !values.publish &&
    !values.unpublish
  ) {
    throw new Error(
      "已发布流程不能直接修改定义；请先取消发布，或使用发布操作提交新版本。"
    );
  }
}
type WorkflowUser = { id: number; role: "user" | "admin" };
type VersionSource =
  | "created"
  | "updated"
  | "published"
  | "unpublished"
  | "rolled_back";
type TemplateNodeType = Exclude<Node["type"], "start" | "end" | "subflow">;

/**
 * Raised when a mutation was based on an older hydrated workflow definition.
 * Callers should refresh and merge their local draft before retrying.
 */
export class WorkflowVersionConflictError extends Error {
  readonly code = "WORKFLOW_VERSION_CONFLICT";

  constructor(
    readonly workflowId: string,
    readonly expectedDefinitionVersion: number,
    readonly actualDefinitionVersion: number
  ) {
    super(
      `流程版本冲突：服务器当前为 v${actualDefinitionVersion}，本地草稿基于 v${expectedDefinitionVersion}。请刷新后合并本地修改再保存。`
    );
    this.name = "WorkflowVersionConflictError";
  }
}

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
      input.executionPlan === undefined
        ? null
        : JSON.stringify(input.executionPlan),
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
  executable: boolean,
  flowType: "state" | "control" | "data"
) {
  const subflowNodes = definition.nodes.filter(node => node.type === "subflow");
  if (!subflowNodes.length) return definition;
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,name,definitionJson,isEnabled,updatedAt FROM workflow_subflow WHERE ownerUserId=?",
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
    const mappedDefinition = parseJson(mapped.definitionJson) as Definition;
    if (executable) {
      validate(mappedDefinition, { flowType, executable: true });
      const unsupported = mappedDefinition.nodes.find(item =>
        [
          "operate",
          "sql",
          "source",
          "table",
          "filter",
          "map",
          "edit_sql",
          "udf",
          "sink",
          "output",
          "subflow",
        ].includes(item.type)
      );
      if (unsupported)
        throw new Error(
          `子流程“${String(mapped.name)}”包含当前同步子流程运行时不支持的节点：${unsupported.name}（${unsupported.type}）。`
        );
    }
    return {
      ...node,
      config: {
        ...node.config,
        subflowId: String(mapped.id),
        executionMode: "sync_snapshot",
        ...(executable
          ? {
              resolvedSubflowName: String(mapped.name),
              resolvedSubflowUpdatedAt: new Date(
                mapped.updatedAt
              ).toISOString(),
              resolvedSubflowDefinition: mappedDefinition,
            }
          : {}),
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
    /**
     * The definition version the caller hydrated. Internal callers may omit
     * this field; the service then uses the authorized preflight snapshot as
     * the conditional-write version.
     */
    expectedDefinitionVersion?: number;
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
    flowType: "state" | "control" | "data";
    definition: Definition;
    publishedExecutionPlanJson?: unknown;
    publishedExecutionPlanHash?: string | null;
  } | null;
  if (!current) return null;
  const expectedDefinitionVersion =
    values.expectedDefinitionVersion === undefined
      ? undefined
      : Number(values.expectedDefinitionVersion);
  if (
    expectedDefinitionVersion !== undefined &&
    (!Number.isSafeInteger(expectedDefinitionVersion) ||
      expectedDefinitionVersion < 1)
  )
    throw new Error("expectedDefinitionVersion 必须是正整数。 ");
  if (current.archivedAt)
    throw new Error("已归档流程必须先恢复后才能编辑或发布。");
  assertWorkflowUpdateTransition(current.status, values);
  const executable = Boolean(values.publish);
  const draftDefinition =
    values.definition === undefined
      ? current.definition
      : validate(values.definition, {
          flowType: current.flowType,
          executable: false,
        });
  const definition = await resolveSubflowReferences(
    draftDefinition,
    current.ownerUserId,
    executable,
    current.flowType
  );
  if (values.publish && current.projectId)
    assertProjectServiceTaskReferences(definition);
  const definitionChanged =
    values.definition !== undefined &&
    JSON.stringify(definition) !== JSON.stringify(current.definition);
  const compiled = executable
    ? compileWorkflowDefinition(definition, { flowType: current.flowType })
    : null;
  const persistedDefinition = compiled?.definition ?? definition;
  const persistedExecutionPlan = values.unpublish
    ? undefined
    : (compiled?.plan ??
      (current.publishedExecutionPlanJson === undefined
        ? undefined
        : parseJson(current.publishedExecutionPlanJson)));
  const persistedExecutionPlanHash = values.unpublish
    ? null
    : (compiled?.planHash ?? current.publishedExecutionPlanHash ?? null);
  if (
    values.publish &&
    current.projectId &&
    (await isProjectApprovalRequired()) &&
    (current.auditStatus !== "approved" || definitionChanged)
  )
    throw new Error(
      definitionChanged
        ? "项目流程定义已变更，必须先保存草稿并重新审核后才能发布。"
        : "当前审批规则要求项目流程通过审核后才能发布。"
    );
  const nextName = values.name ?? current.name;
  let nextStatus: "draft" | "published" = current.status;
  const preflightDefinitionVersion = Number(current.definitionVersion);
  const versionToMatch =
    expectedDefinitionVersion ?? preflightDefinitionVersion;
  let nextVersion = 0;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [lockedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT projectId,status,auditStatus,archivedAt,definitionVersion FROM workflow WHERE id=? LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    const locked = lockedRows[0] as
      | {
          projectId?: string | null;
          status: "draft" | "published";
          auditStatus?: "init" | "approved" | "rejected" | null;
          archivedAt?: Date | string | null;
          definitionVersion: number;
        }
      | undefined;
    if (!locked) throw new Error("流程不存在。");
    const lockedDefinitionVersion = Number(locked.definitionVersion);
    if (lockedDefinitionVersion !== versionToMatch)
      throw new WorkflowVersionConflictError(
        workflowId,
        versionToMatch,
        lockedDefinitionVersion
      );
    if (locked.archivedAt)
      throw new Error("已归档流程必须先恢复后才能编辑或发布。");
    // State can be changed by governance operations that do not create a
    // definition version. Re-run this guard against the locked row before
    // writing so a stale preflight cannot cross a lifecycle boundary.
    assertWorkflowUpdateTransition(locked.status, values);
    if (
      values.publish &&
      locked.projectId &&
      (await isProjectApprovalRequired()) &&
      (locked.auditStatus !== "approved" || definitionChanged)
    )
      throw new Error(
        definitionChanged
          ? "项目流程定义已变更，必须先保存草稿并重新审核后才能发布。"
          : "当前审批规则要求项目流程通过审核后才能发布。"
      );
    nextVersion = lockedDefinitionVersion + 1;
    nextStatus = values.unpublish
      ? "draft"
      : values.publish
        ? "published"
        : locked.status;
    const [updateResult] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE workflow SET name=?, definitionJson=?, status=?, definitionVersion=?, auditStatus=CASE WHEN ? THEN 'init' ELSE auditStatus END, publishedExecutionPlanJson=?, publishedExecutionPlanHash=?, publishedAt=CASE WHEN ? THEN NOW() WHEN ? THEN NULL ELSE publishedAt END, unpublishedAt=CASE WHEN ? THEN NOW() ELSE unpublishedAt END, updatedAt=NOW() WHERE id=? AND definitionVersion=?",
      [
        nextName,
        JSON.stringify(persistedDefinition),
        nextStatus,
        nextVersion,
        Boolean(current.projectId && definitionChanged),
        values.unpublish
          ? null
          : persistedExecutionPlan === undefined
            ? null
            : JSON.stringify(persistedExecutionPlan),
        persistedExecutionPlanHash,
        Boolean(values.publish),
        Boolean(values.unpublish),
        Boolean(values.unpublish),
        workflowId,
        versionToMatch,
      ]
    );
    if (!updateResult.affectedRows)
      throw new WorkflowVersionConflictError(
        workflowId,
        versionToMatch,
        lockedDefinitionVersion
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
      executionPlan: persistedExecutionPlan,
      executionPlanHash: persistedExecutionPlanHash,
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
    flowType: "state" | "control" | "data";
  } | null;
  if (!current) return null;
  if (current.archivedAt)
    throw new Error("已归档流程必须先恢复后才能编译发布。 ");
  const draft = candidateDefinition ?? current.definition;
  const structural = analyzeWorkflowDefinition(draft, {
    flowType: current.flowType,
    executable: true,
  });
  if (!structural.ok) return structural;
  try {
    const resolved = await resolveSubflowReferences(
      structural.definition,
      current.ownerUserId,
      true,
      current.flowType
    );
    return compileWorkflowDefinition(resolved, {
      flowType: current.flowType,
    });
  } catch (error) {
    if (error && typeof error === "object" && "diagnostics" in error)
      return {
        ok: false,
        diagnostics: (error as { diagnostics: WorkflowCompileDiagnostic[] })
          .diagnostics,
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
  const restoredDefinition = target.definition;
  const connection = await db().getConnection();
  let nextVersion = 0;
  try {
    await connection.beginTransaction();
    const [currentRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT ownerUserId,projectId,name,definitionVersion,flowType,status,auditStatus,archivedAt FROM workflow WHERE id=? LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    const current = currentRows[0] as {
      ownerUserId: number;
      projectId?: string | null;
      name: string;
      definitionVersion: number;
      flowType: "state" | "control" | "data";
      auditStatus: "init" | "approved" | "rejected";
      archivedAt?: Date | string | null;
    } | undefined;
    if (!current) throw new Error("流程不存在。");
    if (current.archivedAt)
      throw new Error("已归档流程必须先恢复后才能回滚版本。");
    nextVersion = Number(current.definitionVersion) + 1;

    // A rollback is a definition change, never an implicit publication. For
    // project workflows it must re-enter the review queue even if the target
    // snapshot used to be published; the next publish operation will compile
    // a fresh execution plan after approval.
    const nextAuditStatus = current.projectId ? "init" : current.auditStatus;
    await connection.query(
      "UPDATE workflow SET name=?,definitionJson=?,status='draft',definitionVersion=?,auditStatus=?,publishedExecutionPlanJson=NULL,publishedExecutionPlanHash=NULL,publishedAt=NULL,unpublishedAt=NOW(),updatedAt=NOW() WHERE id=?",
      [
        target.name,
        JSON.stringify(restoredDefinition),
        nextVersion,
        nextAuditStatus,
        workflowId,
      ]
    );
    await insertVersion(connection, {
      workflowId,
      version: nextVersion,
      name: target.name,
      status: "draft",
      definition: restoredDefinition,
      source: "rolled_back",
      actorUserId: user.id,
      restoredFromVersion: targetVersion,
      executionPlan: undefined,
      executionPlanHash: null,
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
  input: {
    name: string;
    description?: string;
    definition: unknown;
    flowType?: "state" | "control";
  }
) {
  const definition = validate(input.definition, {
    flowType: input.flowType ?? "state",
    executable: true,
  });
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
    flowType?: "state" | "control";
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
      : validate(input.definition, {
          flowType: input.flowType ?? "state",
          executable: true,
        });
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
      "SELECT id FROM workflow_run WHERE workflowId=? AND status IN ('queued','running','waiting','blocked') LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    if (activeRuns.length)
      throw new Error(
        "流程存在排队、运行、等待人工处理或暂停中的实例，禁止归档；请先完成、恢复处理或取消活动运行。"
      );
    const [activeTasks] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_task WHERE workflowId=? AND status IN ('pending','claimed') LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    if (activeTasks.length)
      throw new Error("流程仍有未结束的人工任务，禁止归档。 ");
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
