import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import mysql from "mysql2/promise";
import { recordAuthorizationAudit } from "./iam-service";
import { getProjectAccess, type ProjectUser } from "./project-service";
import {
  createHeartbeatJob,
  deleteHeartbeatJob,
  updateHeartbeatJob,
} from "./_core/heartbeat";
import { sdk } from "./_core/sdk";
import { currentRequestId } from "./_core/http-security";
import {
  assertWorkflowExecutionPlan,
  compileWorkflowDefinition,
  type WorkflowExecutionPlan,
} from "./workflow-compiler";

type JsonRecord = Record<string, unknown>;
type ResourceKind = "source" | "asset" | "udf" | "tag" | "plugin";
type DataflowUser = ProjectUser;

const id = () => randomBytes(12).toString("base64url");
const dataflowWorkerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
const dataflowLeaseSeconds = Math.max(
  30,
  Number(process.env.DATAFLOW_WORKER_LEASE_SECONDS ?? 120)
);
let pool: mysql.Pool | undefined;
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
};

async function recordScheduleAudit(input: {
  actorUserId: number;
  resourceId: string;
  projectId: string;
  workflowId: string;
  cronExpression: string;
}) {
  await db().query(
    "INSERT INTO authorization_audit_log (id,actorUserId,targetUserId,action,resourceType,resourceId,detailsJson) VALUES (?,?,?,?,?,?,?)",
    [
      randomUUID(),
      input.actorUserId,
      null,
      "user_updated",
      "dataflow_schedule",
      input.resourceId,
      JSON.stringify({
        operation: "draft_saved",
        projectId: input.projectId,
        workflowId: input.workflowId,
        cronExpression: input.cronExpression,
      }),
    ]
  );
}

async function requireProjectAccess(
  user: DataflowUser,
  projectId: string,
  mode: "view" | "edit" | "run"
) {
  const access = await getProjectAccess(user, projectId);
  const permission =
    mode === "view"
      ? "project:view"
      : mode === "edit"
        ? "project:workflow:edit"
        : "project:workflow:run";
  if (!access.exists || !access.permissions.has(permission))
    throw new Error("项目不存在或当前账号无权执行此数据资源操作。");
  return access;
}

function parseJson(value: unknown, fallback: unknown = {}) {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeRows(value: unknown) {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray((value as JsonRecord | undefined)?.rows)
      ? ((value as JsonRecord).rows as unknown[])
      : [];
  return rows
    .slice(0, 200)
    .filter(row => row && typeof row === "object")
    .map(row => JSON.parse(JSON.stringify(row)) as JsonRecord);
}

function assertNoInlineSecret(value: unknown) {
  const serialized = JSON.stringify(value ?? {}).toLowerCase();
  if (/(password|passwd|secret|token|api[_-]?key)\s*["':=]/.test(serialized))
    throw new Error("连接配置不得包含明文凭据；请使用凭据引用字段。 ");
}

function cleanSource(row: mysql.RowDataPacket) {
  const { credentialRef, connectionJson, ...source } = row;
  const connection = parseJson(connectionJson, {}) as JsonRecord;
  const {
    password: _password,
    token: _token,
    secret: _secret,
    apiKey: _apiKey,
    ...safeConnection
  } = connection;
  return {
    ...source,
    connection: safeConnection,
    hasCredentialRef: Boolean(credentialRef),
  };
}

export async function listDataResources(user: DataflowUser, projectId: string) {
  await requireProjectAccess(user, projectId, "view");
  const [sources, assets, udfs, tags, plugins] = await Promise.all([
    db().query<mysql.RowDataPacket[]>(
      "SELECT * FROM data_source WHERE projectId=? ORDER BY updatedAt DESC",
      [projectId]
    ),
    db().query<mysql.RowDataPacket[]>(
      "SELECT a.*,s.name AS sourceName FROM data_asset a LEFT JOIN data_source s ON s.id=a.sourceId WHERE a.projectId=? ORDER BY a.updatedAt DESC",
      [projectId]
    ),
    db().query<mysql.RowDataPacket[]>(
      "SELECT * FROM data_udf WHERE projectId=? ORDER BY updatedAt DESC",
      [projectId]
    ),
    db().query<mysql.RowDataPacket[]>(
      "SELECT * FROM data_tag WHERE projectId=? ORDER BY name",
      [projectId]
    ),
    db().query<mysql.RowDataPacket[]>(
      "SELECT * FROM project_plugin WHERE projectId=? ORDER BY updatedAt DESC",
      [projectId]
    ),
  ]);
  return {
    sources: sources[0].map(cleanSource),
    assets: assets[0].map(row => ({
      ...row,
      schema: parseJson(row.schemaJson, []),
      sample: normalizeRows(parseJson(row.sampleJson, [])),
      schemaJson: undefined,
      sampleJson: undefined,
    })),
    udfs: udfs[0].map(row => ({
      ...row,
      params: parseJson(row.paramsJson, []),
      paramsJson: undefined,
    })),
    tags: tags[0],
    plugins: plugins[0].map(row => ({
      ...row,
      config: parseJson(row.configJson, {}),
      configJson: undefined,
    })),
  };
}

export async function createDataSource(
  user: DataflowUser,
  input: {
    projectId: string;
    name: string;
    sourceType: "jdbc" | "api" | "file" | "inline";
    connection: JsonRecord;
    credentialRef?: string;
  }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  assertNoInlineSecret(input.connection);
  const sourceId = id();
  await db().query(
    "INSERT INTO data_source (id,projectId,name,sourceType,connectionJson,credentialRef,status,lastTestedAt,createdByUserId) VALUES (?,?,?,?,?,?,'draft',NULL,?)",
    [
      sourceId,
      input.projectId,
      input.name.trim(),
      input.sourceType,
      JSON.stringify(input.connection),
      input.credentialRef?.trim() || null,
      user.id,
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "data_source",
    resourceId: sourceId,
    details: {
      operation: "created",
      projectId: input.projectId,
      sourceType: input.sourceType,
    },
  });
  return sourceId;
}

export async function updateDataSource(
  user: DataflowUser,
  input: {
    projectId: string;
    sourceId: string;
    name?: string;
    status?: "draft" | "disabled";
    connection?: JsonRecord;
    credentialRef?: string | null;
  }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  if (input.connection) assertNoInlineSecret(input.connection);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM data_source WHERE id=? AND projectId=? LIMIT 1",
    [input.sourceId, input.projectId]
  );
  if (!rows[0]) throw new Error("数据源不存在或不属于当前项目。 ");
  const current = rows[0];
  const configurationChanged =
    input.connection !== undefined || input.credentialRef !== undefined;
  await db().query(
    "UPDATE data_source SET name=?,status=?,connectionJson=?,credentialRef=?,lastTestedAt=CASE WHEN ? THEN NULL ELSE lastTestedAt END,updatedAt=NOW() WHERE id=? AND projectId=?",
    [
      input.name?.trim() || current.name,
      configurationChanged ? "draft" : (input.status ?? current.status),
      JSON.stringify(input.connection ?? parseJson(current.connectionJson, {})),
      input.credentialRef === undefined
        ? current.credentialRef
        : input.credentialRef?.trim() || null,
      configurationChanged,
      input.sourceId,
      input.projectId,
    ]
  );
  return true;
}

export async function deleteDataSource(
  user: DataflowUser,
  projectId: string,
  sourceId: string
) {
  await requireProjectAccess(user, projectId, "edit");
  const [assets] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id FROM data_asset WHERE sourceId=? LIMIT 1",
    [sourceId]
  );
  if (assets[0])
    throw new Error("数据源仍包含已探查资源，请先移除或迁移资源。 ");
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM data_source WHERE id=? AND projectId=?",
    [sourceId, projectId]
  );
  if (!result.affectedRows) throw new Error("数据源不存在或不属于当前项目。 ");
  return true;
}

export async function createDataAsset(
  user: DataflowUser,
  input: {
    projectId: string;
    sourceId?: string | null;
    name: string;
    assetType: "table" | "view" | "file" | "endpoint" | "dataset";
    schema: unknown[];
    sample?: unknown[];
  }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  if (input.sourceId) {
    const [sources] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM data_source WHERE id=? AND projectId=? LIMIT 1",
      [input.sourceId, input.projectId]
    );
    if (!sources[0]) throw new Error("关联数据源不存在或不属于当前项目。 ");
  }
  const assetId = id();
  await db().query(
    "INSERT INTO data_asset (id,projectId,sourceId,name,assetType,schemaJson,sampleJson,status,createdByUserId) VALUES (?,?,?,?,?,?,?,'active',?)",
    [
      assetId,
      input.projectId,
      input.sourceId ?? null,
      input.name.trim(),
      input.assetType,
      JSON.stringify(input.schema.slice(0, 100)),
      JSON.stringify(normalizeRows(input.sample)),
      user.id,
    ]
  );
  return assetId;
}

export async function updateDataAsset(
  user: DataflowUser,
  input: {
    projectId: string;
    assetId: string;
    name?: string;
    schema?: unknown[];
    sample?: unknown[];
    status?: "active" | "disabled";
  }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM data_asset WHERE id=? AND projectId=? LIMIT 1",
    [input.assetId, input.projectId]
  );
  if (!rows[0]) throw new Error("数据资源不存在或不属于当前项目。 ");
  const current = rows[0];
  await db().query(
    "UPDATE data_asset SET name=?,schemaJson=?,sampleJson=?,status=?,updatedAt=NOW() WHERE id=? AND projectId=?",
    [
      input.name?.trim() || current.name,
      JSON.stringify(input.schema ?? parseJson(current.schemaJson, [])),
      JSON.stringify(
        input.sample === undefined
          ? normalizeRows(parseJson(current.sampleJson, []))
          : normalizeRows(input.sample)
      ),
      input.status ?? current.status,
      input.assetId,
      input.projectId,
    ]
  );
  return true;
}

export async function deleteDataAsset(
  user: DataflowUser,
  projectId: string,
  assetId: string
) {
  await requireProjectAccess(user, projectId, "edit");
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM data_asset WHERE id=? AND projectId=?",
    [assetId, projectId]
  );
  if (!result.affectedRows)
    throw new Error("数据资源不存在或不属于当前项目。 ");
  return true;
}

export async function createDataUdf(
  user: DataflowUser,
  input: {
    projectId: string;
    name: string;
    udfType: "sql" | "javascript" | "python" | "jar";
    description?: string;
    params?: unknown[];
    returnType?: string;
    artifactRef?: string;
  }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  const udfId = id();
  await db().query(
    "INSERT INTO data_udf (id,projectId,name,udfType,description,paramsJson,returnType,artifactRef,status,createdByUserId) VALUES (?,?,?,?,?,?,?,?, 'draft',?)",
    [
      udfId,
      input.projectId,
      input.name.trim(),
      input.udfType,
      input.description?.trim() || null,
      JSON.stringify(input.params ?? []),
      input.returnType?.trim() || null,
      input.artifactRef?.trim() || null,
      user.id,
    ]
  );
  return udfId;
}

export async function updateDataUdf(
  user: DataflowUser,
  input: {
    projectId: string;
    udfId: string;
    name?: string;
    description?: string | null;
    params?: unknown[];
    returnType?: string | null;
    status?: "draft" | "approved" | "disabled";
  }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM data_udf WHERE id=? AND projectId=? LIMIT 1",
    [input.udfId, input.projectId]
  );
  if (!rows[0]) throw new Error("UDF 不存在或不属于当前项目。 ");
  const current = rows[0];
  await db().query(
    "UPDATE data_udf SET name=?,description=?,paramsJson=?,returnType=?,status=?,updatedAt=NOW() WHERE id=? AND projectId=?",
    [
      input.name?.trim() || current.name,
      input.description === undefined
        ? current.description
        : input.description?.trim() || null,
      JSON.stringify(input.params ?? parseJson(current.paramsJson, [])),
      input.returnType === undefined
        ? current.returnType
        : input.returnType?.trim() || null,
      input.status ?? current.status,
      input.udfId,
      input.projectId,
    ]
  );
  return true;
}

export async function deleteDataUdf(
  user: DataflowUser,
  projectId: string,
  udfId: string
) {
  await requireProjectAccess(user, projectId, "edit");
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM data_udf WHERE id=? AND projectId=?",
    [udfId, projectId]
  );
  if (!result.affectedRows) throw new Error("UDF 不存在或不属于当前项目。 ");
  return true;
}

export async function createDataTag(
  user: DataflowUser,
  input: { projectId: string; name: string; color?: string }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  const tagId = id();
  await db().query(
    "INSERT INTO data_tag (id,projectId,name,color,createdByUserId) VALUES (?,?,?,?,?)",
    [
      tagId,
      input.projectId,
      input.name.trim(),
      input.color ?? "#2d6bea",
      user.id,
    ]
  );
  return tagId;
}

export async function deleteDataTag(
  user: DataflowUser,
  projectId: string,
  tagId: string
) {
  await requireProjectAccess(user, projectId, "edit");
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM data_tag WHERE id=? AND projectId=?",
    [tagId, projectId]
  );
  if (!result.affectedRows) throw new Error("标签不存在或不属于当前项目。 ");
  return true;
}

export async function createProjectPlugin(
  user: DataflowUser,
  input: {
    projectId: string;
    name: string;
    pluginType: "transform" | "connector" | "visualization";
    version: string;
    config?: JsonRecord;
  }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  assertNoInlineSecret(input.config);
  const pluginId = id();
  await db().query(
    "INSERT INTO project_plugin (id,projectId,name,pluginType,version,configJson,status,createdByUserId) VALUES (?,?,?,?,?,?,'enabled',?)",
    [
      pluginId,
      input.projectId,
      input.name.trim(),
      input.pluginType,
      input.version.trim(),
      JSON.stringify(input.config ?? {}),
      user.id,
    ]
  );
  return pluginId;
}

export async function updateProjectPlugin(
  user: DataflowUser,
  input: {
    projectId: string;
    pluginId: string;
    status?: "enabled" | "disabled";
    version?: string;
    config?: JsonRecord;
  }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  if (input.config) assertNoInlineSecret(input.config);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM project_plugin WHERE id=? AND projectId=? LIMIT 1",
    [input.pluginId, input.projectId]
  );
  if (!rows[0]) throw new Error("插件不存在或不属于当前项目。 ");
  const current = rows[0];
  await db().query(
    "UPDATE project_plugin SET status=?,version=?,configJson=?,updatedAt=NOW() WHERE id=? AND projectId=?",
    [
      input.status ?? current.status,
      input.version?.trim() || current.version,
      JSON.stringify(input.config ?? parseJson(current.configJson, {})),
      input.pluginId,
      input.projectId,
    ]
  );
  return true;
}

export async function deleteProjectPlugin(
  user: DataflowUser,
  projectId: string,
  pluginId: string
) {
  await requireProjectAccess(user, projectId, "edit");
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM project_plugin WHERE id=? AND projectId=?",
    [pluginId, projectId]
  );
  if (!result.affectedRows) throw new Error("插件不存在或不属于当前项目。 ");
  return true;
}

export async function listDataflows(user: DataflowUser, projectId: string) {
  await requireProjectAccess(user, projectId, "view");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT w.*, (SELECT COUNT(*) FROM dataflow_run r WHERE r.workflowId=w.id) AS dataflowRunCount, (SELECT status FROM dataflow_schedule s WHERE s.workflowId=w.id LIMIT 1) AS scheduleStatus FROM workflow w WHERE w.projectId=? AND w.flowType='data' ORDER BY w.updatedAt DESC",
    [projectId]
  );
  return rows.map(row => ({
    ...row,
    definition: parseJson(row.definitionJson, { nodes: [], edges: [] }),
    definitionJson: undefined,
  }));
}

function nodeConfig(node: any): JsonRecord {
  return (node?.config ?? node?.data?.config ?? node?.data ?? {}) as JsonRecord;
}
function rowsFromInput(values: unknown[]) {
  return values.flatMap(value =>
    normalizeRows((value as JsonRecord | undefined)?.rows ?? value)
  );
}

export function compileDataflowExecutionPlan(definition: unknown) {
  const compiled = compileWorkflowDefinition(definition, { flowType: "data" });
  if (!compiled.plan.topologicalOrder)
    throw new Error("数据流执行计划必须是无环 DAG。");
  return { plan: compiled.plan, planHash: compiled.planHash };
}

async function runDataflowDefinition(
  projectId: string,
  executionPlan: WorkflowExecutionPlan,
  runId: string,
  requestId: string | null
) {
  const definition = executionPlan.definition;
  const nodes: any[] = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges: any[] = Array.isArray(definition?.edges) ? definition.edges : [];
  if (!nodes.length) throw new Error("数据流定义没有节点。 ");
  const byId = new Map(nodes.map((node: any) => [String(node.id), node]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  nodes.forEach((node: any) => {
    incoming.set(String(node.id), []);
    outgoing.set(String(node.id), []);
  });
  edges.forEach((edge: any) => {
    const source = String(edge.sourceNodeId ?? edge.source ?? "");
    const target = String(edge.targetNodeId ?? edge.target ?? "");
    if (byId.has(source) && byId.has(target)) {
      outgoing.get(source)?.push(target);
      incoming.get(target)?.push(source);
    }
  });
  if (!executionPlan.topologicalOrder)
    throw new Error("数据流执行计划缺少稳定拓扑顺序。");
  const queue = [...executionPlan.topologicalOrder];
  const outputs = new Map<string, JsonRecord>();
  const executed: JsonRecord[] = [];
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (outputs.has(nodeId)) continue;
    const node = byId.get(nodeId)!;
    const inputs = (incoming.get(nodeId) ?? [])
      .map(parentId => outputs.get(parentId))
      .filter(Boolean) as JsonRecord[];
    const config = nodeConfig(node);
    const nodeStartedAt = Date.now();
    const sequenceNo = executed.length;
    await db().query(
      `INSERT INTO dataflow_node_run
        (id,runId,nodeId,sequenceNo,nodeType,status,attempt,inputJson,requestId,startedAt)
       VALUES (?,?,?,?,?,'running',1,?,?,NOW())
       ON DUPLICATE KEY UPDATE status='running',attempt=attempt+1,inputJson=VALUES(inputJson),outputJson=NULL,errorJson=NULL,rowCount=NULL,requestId=VALUES(requestId),startedAt=NOW(),finishedAt=NULL,durationMs=NULL`,
      [
        id(),
        runId,
        nodeId,
        sequenceNo,
        String(node.type),
        JSON.stringify(inputs),
        requestId,
      ]
    );
    let output: JsonRecord;
    try {
      if (["start", "begin"].includes(String(node.type)))
        output = { rows: rowsFromInput(inputs), stage: "start" };
      else if (["source", "data_source", "table"].includes(String(node.type))) {
        const assetId = String(config.assetId ?? "");
        const [assets] = await db().query<mysql.RowDataPacket[]>(
          "SELECT * FROM data_asset WHERE id=? AND projectId=? AND status='active' LIMIT 1",
          [assetId, projectId]
        );
        if (!assets[0])
          throw new Error(
            `节点 ${node.name ?? node.data?.label ?? nodeId} 引用的数据资源不存在、已停用或不属于当前项目。`
          );
        output = {
          assetId,
          assetName: assets[0].name,
          rows: normalizeRows(parseJson(assets[0].sampleJson, [])),
          schema: parseJson(assets[0].schemaJson, []),
        };
      } else if (["transform", "filter", "map"].includes(String(node.type))) {
        let rows = rowsFromInput(inputs);
        if (
          config.filterField &&
          Object.prototype.hasOwnProperty.call(config, "filterValue")
        )
          rows = rows.filter(
            row =>
              String(row[String(config.filterField)]) ===
              String(config.filterValue)
          );
        const columns = Array.isArray(config.columns)
          ? config.columns.map(column => String(column))
          : [];
        if (columns.length)
          rows = rows.map(row =>
            Object.fromEntries(columns.map(column => [column, row[column]]))
          );
        const limit = Number(config.limit ?? 200);
        output = {
          rows: rows.slice(
            0,
            Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 200
          ),
          operation: "safe_transform",
        };
      } else if (["sql", "edit_sql"].includes(String(node.type))) {
        const statement = String(
          config.statement ?? config.sql ?? config.query ?? ""
        ).trim();
        if (
          !/^select\s+/i.test(statement) ||
          /;|\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i.test(
            statement
          )
        )
          throw new Error(
            "SQL 节点仅支持单条只读 SELECT 计划；禁止写入和 DDL。 "
          );
        output = {
          rows: rowsFromInput(inputs),
          statement,
          execution: "validated_read_plan",
        };
      } else if (String(node.type) === "udf") {
        const udfId = String(config.udfId ?? "");
        const [udfs] = await db().query<mysql.RowDataPacket[]>(
          "SELECT name,udfType FROM data_udf WHERE id=? AND projectId=? AND status='approved' LIMIT 1",
          [udfId, projectId]
        );
        if (!udfs[0]) throw new Error("UDF 不存在、未审核或不属于当前项目。 ");
        output = {
          rows: rowsFromInput(inputs),
          udf: { name: udfs[0].name, type: udfs[0].udfType },
          execution: "metadata_safe",
        };
      } else if (["end", "sink", "output"].includes(String(node.type)))
        output = { rows: rowsFromInput(inputs), stage: "output" };
      else throw new Error(`数据流节点类型 ${String(node.type)} 尚未启用。`);
      outputs.set(nodeId, output);
      executed.push({
        nodeId,
        nodeType: node.type,
        rowCount: normalizeRows(output.rows).length,
        output,
      });
      await db().query(
        "UPDATE dataflow_node_run SET status='success',outputJson=?,rowCount=?,finishedAt=NOW(),durationMs=? WHERE runId=? AND nodeId=? AND status='running'",
        [
          JSON.stringify(output),
          normalizeRows(output.rows).length,
          Date.now() - nodeStartedAt,
          runId,
          nodeId,
        ]
      );
    } catch (error) {
      await db().query(
        "UPDATE dataflow_node_run SET status='failed',errorJson=?,finishedAt=NOW(),durationMs=? WHERE runId=? AND nodeId=? AND status='running'",
        [
          JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
          }),
          Date.now() - nodeStartedAt,
          runId,
          nodeId,
        ]
      );
      throw error;
    }
  }
  if (outputs.size !== nodes.length)
    throw new Error("数据流存在循环依赖或不可达节点。 ");
  const terminal = nodes
    .filter((node: any) => !(outgoing.get(String(node.id)) ?? []).length)
    .map((node: any) => outputs.get(String(node.id)))
    .filter(Boolean);
  return { terminals: terminal, nodes: executed };
}

type ClaimedDataflowJob = {
  id: string;
  runId: string;
  projectId: string;
  leaseToken: string;
  attempt: number;
  maxAttempts: number;
  executionPlan: WorkflowExecutionPlan;
  executionPlanHash: string;
  requestId: string | null;
};

async function claimDataflowJob(
  onlyRunId?: string
): Promise<ClaimedDataflowJob | null> {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const params: unknown[] = [];
    const runFilter = onlyRunId ? " AND j.runId=?" : "";
    if (onlyRunId) params.push(onlyRunId);
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT j.id,j.runId,j.attempt,j.maxAttempts,r.projectId,r.executionPlanJson,r.executionPlanHash,r.requestId
         FROM dataflow_run_job j JOIN dataflow_run r ON r.id=j.runId
        WHERE j.attempt<j.maxAttempts AND r.status IN ('queued','running')${runFilter}
          AND ((j.status='queued' AND j.availableAt<=NOW()) OR (j.status='leased' AND j.leaseExpiresAt<NOW()))
        ORDER BY j.availableAt,j.createdAt LIMIT 1 FOR UPDATE SKIP LOCKED`,
      params
    );
    const row = rows[0];
    if (!row) {
      await connection.commit();
      return null;
    }
    const executionPlanHash = String(row.executionPlanHash ?? "");
    let executionPlan: WorkflowExecutionPlan;
    try {
      executionPlan = assertWorkflowExecutionPlan(
        parseJson(row.executionPlanJson, null),
        executionPlanHash,
        "data"
      );
    } catch (error) {
      const details = JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        code: "DATAFLOW_EXECUTION_PLAN_INVALID",
      });
      await connection.query(
        "UPDATE dataflow_run_job SET status='failed',lastErrorJson=?,finishedAt=NOW(),leaseToken=NULL,leaseExpiresAt=NULL,workerId=NULL WHERE id=?",
        [details, row.id]
      );
      await connection.query(
        "UPDATE dataflow_run SET status='failed',errorJson=?,finishedAt=NOW() WHERE id=? AND status IN ('queued','running')",
        [details, row.runId]
      );
      await connection.commit();
      return null;
    }
    const leaseToken = randomUUID().replaceAll("-", "").slice(0, 48);
    const [claimed] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE dataflow_run_job
          SET status='leased',attempt=attempt+1,leaseToken=?,leaseExpiresAt=DATE_ADD(NOW(),INTERVAL ? SECOND),workerId=?,lastErrorJson=NULL
        WHERE id=? AND ((status='queued' AND availableAt<=NOW()) OR (status='leased' AND leaseExpiresAt<NOW()))`,
      [leaseToken, dataflowLeaseSeconds, dataflowWorkerId, row.id]
    );
    if (!claimed.affectedRows) {
      await connection.rollback();
      return null;
    }
    const [leasedRun] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE dataflow_run SET status='running',startedAt=COALESCE(startedAt,NOW()) WHERE id=? AND status IN ('queued','running')",
      [row.runId]
    );
    if (!leasedRun.affectedRows) throw new Error("无法取得数据流运行租约。");
    await connection.commit();
    return {
      id: String(row.id),
      runId: String(row.runId),
      projectId: String(row.projectId),
      leaseToken,
      attempt: Number(row.attempt ?? 0) + 1,
      maxAttempts: Number(row.maxAttempts ?? 3),
      executionPlan,
      executionPlanHash,
      requestId: row.requestId ? String(row.requestId) : null,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function processDataflowJob(job: ClaimedDataflowJob) {
  const renewer = setInterval(
    () => {
      void db()
        .query(
          "UPDATE dataflow_run_job SET leaseExpiresAt=DATE_ADD(NOW(),INTERVAL ? SECOND) WHERE id=? AND status='leased' AND leaseToken=?",
          [dataflowLeaseSeconds, job.id, job.leaseToken]
        )
        .catch(() => undefined);
    },
    Math.max(10_000, Math.floor((dataflowLeaseSeconds * 1000) / 3))
  );
  renewer.unref?.();
  const startedAt = Date.now();
  try {
    const output = await runDataflowDefinition(
      job.projectId,
      job.executionPlan,
      job.runId,
      job.requestId
    );
    const connection = await db().getConnection();
    try {
      await connection.beginTransaction();
      const [completed] = await connection.query<mysql.ResultSetHeader>(
        "UPDATE dataflow_run_job SET status='completed',resultJson=?,leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW() WHERE id=? AND status='leased' AND leaseToken=?",
        [JSON.stringify(output), job.id, job.leaseToken]
      );
      if (!completed.affectedRows)
        throw new Error("数据流 Job 完成时租约已失效。");
      const [completedRun] = await connection.query<mysql.ResultSetHeader>(
        "UPDATE dataflow_run SET status='success',outputJson=?,errorJson=NULL,finishedAt=NOW(),durationMs=? WHERE id=? AND status='running'",
        [JSON.stringify(output), Date.now() - startedAt, job.runId]
      );
      if (!completedRun.affectedRows)
        throw new Error("数据流运行完成时状态已改变。");
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    const details = {
      message: error instanceof Error ? error.message : String(error),
    };
    const connection = await db().getConnection();
    try {
      await connection.beginTransaction();
      const retry = job.attempt < job.maxAttempts;
      const delaySeconds = Math.min(60, 2 ** Math.max(0, job.attempt - 1));
      const [updated] = await connection.query<mysql.ResultSetHeader>(
        `UPDATE dataflow_run_job
            SET status=?,lastErrorJson=?,availableAt=IF(?='queued',DATE_ADD(NOW(),INTERVAL ? SECOND),availableAt),leaseToken=NULL,leaseExpiresAt=NULL,workerId=NULL,finishedAt=IF(?='failed',NOW(),NULL)
          WHERE id=? AND status='leased' AND leaseToken=?`,
        [
          retry ? "queued" : "failed",
          JSON.stringify(details),
          retry ? "queued" : "failed",
          delaySeconds,
          retry ? "queued" : "failed",
          job.id,
          job.leaseToken,
        ]
      );
      if (!updated.affectedRows)
        throw new Error("数据流 Job 失败处理时租约已失效。");
      const [updatedRun] = await connection.query<mysql.ResultSetHeader>(
        "UPDATE dataflow_run SET status=?,errorJson=?,finishedAt=IF(?='failed',NOW(),NULL),durationMs=IF(?='failed',?,NULL) WHERE id=? AND status='running'",
        [
          retry ? "queued" : "failed",
          JSON.stringify(details),
          retry ? "queued" : "failed",
          retry ? "queued" : "failed",
          Date.now() - startedAt,
          job.runId,
        ]
      );
      if (!updatedRun.affectedRows)
        throw new Error("数据流运行失败处理时状态已改变。");
      await connection.commit();
    } catch (failureError) {
      await connection.rollback();
      throw failureError;
    } finally {
      connection.release();
    }
  } finally {
    clearInterval(renewer);
  }
}

export async function runDataflowJobOnce(onlyRunId?: string) {
  const job = await claimDataflowJob(onlyRunId);
  if (!job) return false;
  await processDataflowJob(job);
  return true;
}

export async function runDataflow(
  user: DataflowUser,
  input: {
    projectId: string;
    workflowId: string;
    data?: JsonRecord;
    triggerType?: "manual" | "schedule";
    scheduleBucket?: string;
  }
) {
  await requireProjectAccess(
    user,
    input.projectId,
    input.triggerType === "schedule" ? "edit" : "run"
  );
  const runId = id();
  let definition: any;
  let executionPlan: WorkflowExecutionPlan;
  let executionPlanHash: string;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [workflows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow WHERE id=? AND projectId=? AND flowType='data' AND status='published' AND archivedAt IS NULL LIMIT 1 FOR UPDATE",
      [input.workflowId, input.projectId]
    );
    const workflow = workflows[0];
    if (!workflow)
      throw new Error("数据流不存在、已归档、未发布或不属于当前项目。 ");
    const publishedPlan = parseJson(workflow.publishedExecutionPlanJson, null);
    if (publishedPlan && workflow.publishedExecutionPlanHash) {
      executionPlan = assertWorkflowExecutionPlan(
        publishedPlan,
        String(workflow.publishedExecutionPlanHash),
        "data"
      );
      executionPlanHash = String(workflow.publishedExecutionPlanHash);
    } else {
      const compiled = compileDataflowExecutionPlan(
        parseJson(workflow.definitionJson, { nodes: [], edges: [] })
      );
      executionPlan = compiled.plan;
      executionPlanHash = compiled.planHash;
    }
    definition = executionPlan.definition;
    const requestId = currentRequestId() ?? null;
    await connection.query(
      "INSERT INTO dataflow_run (id,projectId,workflowId,triggerType,scheduleBucket,status,definitionSnapshotJson,executionPlanJson,executionPlanHash,requestId,inputJson,triggeredByUserId) VALUES (?,?,?,?,?, 'queued',?,?,?,?,?,?)",
      [
        runId,
        input.projectId,
        input.workflowId,
        input.triggerType ?? "manual",
        input.scheduleBucket ?? null,
        JSON.stringify(definition),
        JSON.stringify(executionPlan),
        executionPlanHash,
        requestId,
        JSON.stringify(input.data ?? {}),
        user.id,
      ]
    );
    await connection.query(
      "INSERT INTO dataflow_run_job (id,runId,status,maxAttempts,requestId) VALUES (?,?,'queued',3,?)",
      [id(), runId, requestId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await runDataflowJobOnce(runId);
  const [runRows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT status,outputJson,errorJson FROM dataflow_run WHERE id=? LIMIT 1",
    [runId]
  );
  const persisted = runRows[0];
  if (persisted?.status === "failed")
    throw new Error(
      String(
        parseJson(persisted.errorJson, { message: "数据流执行失败。" }).message
      )
    );
  return {
    runId,
    status: String(persisted?.status ?? "queued") as
      | "queued"
      | "running"
      | "success",
    output: parseJson(persisted?.outputJson, null),
  };
}

export async function listDataflowRuns(
  user: DataflowUser,
  input: { projectId: string; workflowId?: string; limit?: number }
) {
  await requireProjectAccess(user, input.projectId, "view");
  const clauses = ["r.projectId=?"];
  const params: unknown[] = [input.projectId];
  if (input.workflowId) {
    clauses.push("r.workflowId=?");
    params.push(input.workflowId);
  }
  params.push(Math.min(Math.max(input.limit ?? 60, 1), 200));
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT r.*,w.name AS workflowName,u.name AS triggerName FROM dataflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users u ON u.id=r.triggeredByUserId WHERE ${clauses.join(" AND ")} ORDER BY r.createdAt DESC LIMIT ?`,
    params
  );
  return rows.map(row => ({
    ...row,
    input: parseJson(row.inputJson, {}),
    output: parseJson(row.outputJson, null),
    error: parseJson(row.errorJson, null),
    inputJson: undefined,
    outputJson: undefined,
    errorJson: undefined,
  }));
}

function validateScheduleCron(cronExpression: string) {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 6)
    throw new Error("调度表达式必须为 6 段 UTC 格式：秒 分 时 日 月 星期。 ");
  if (parts[0] !== "0")
    throw new Error("数据流调度最小频率为 60 秒，秒字段必须为 0。 ");
  if (parts.some(part => !/^[\d*/?,\-]+$/.test(part)))
    throw new Error("调度表达式包含不支持的字符。 ");
  return parts.join(" ");
}

async function getPublishedDataflow(projectId: string, workflowId: string) {
  const [workflows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,name FROM workflow WHERE id=? AND projectId=? AND flowType='data' AND status='published' AND archivedAt IS NULL LIMIT 1",
    [workflowId, projectId]
  );
  if (!workflows[0]) throw new Error("数据流不存在、未发布或不属于当前项目。 ");
  return workflows[0];
}

export async function listDataflowSchedules(
  user: DataflowUser,
  projectId: string
) {
  await requireProjectAccess(user, projectId, "view");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT s.*,w.name AS workflowName,u.name AS creatorName FROM dataflow_schedule s JOIN workflow w ON w.id=s.workflowId LEFT JOIN users u ON u.id=s.createdByUserId WHERE s.projectId=? AND s.status<>'deleted' ORDER BY s.updatedAt DESC",
    [projectId]
  );
  return rows.map(row => ({
    ...row,
    taskConfigured: Boolean(row.scheduleCronTaskUid),
    scheduleCronTaskUid: undefined,
  }));
}

/** Save a paused draft before deployment. It cannot create a hosted job until the callback exists on a published site. */
export async function saveDataflowScheduleDraft(
  user: DataflowUser,
  input: { projectId: string; workflowId: string; cronExpression: string }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  await getPublishedDataflow(input.projectId, input.workflowId);
  const cronExpression = validateScheduleCron(input.cronExpression);
  const [existing] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM dataflow_schedule WHERE workflowId=? LIMIT 1",
    [input.workflowId]
  );
  const scheduleId = existing[0]?.id ?? id();
  if (existing[0]?.scheduleCronTaskUid) {
    await db().query(
      "UPDATE dataflow_schedule SET cronExpression=?,status='paused',updatedAt=NOW() WHERE id=?",
      [cronExpression, scheduleId]
    );
  } else {
    await db().query(
      `INSERT INTO dataflow_schedule (id,projectId,workflowId,cronExpression,status,createdByUserId)
       VALUES (?,?,?,?, 'paused',?) ON DUPLICATE KEY UPDATE cronExpression=VALUES(cronExpression),status='paused',updatedAt=NOW()`,
      [scheduleId, input.projectId, input.workflowId, cronExpression, user.id]
    );
  }
  await recordScheduleAudit({
    actorUserId: user.id,
    resourceId: scheduleId,
    projectId: input.projectId,
    workflowId: input.workflowId,
    cronExpression,
  });
  return { id: scheduleId, status: "paused" as const, cronExpression };
}

/** Call only after the current checkpoint is published; hosted service will POST by trusted task UID. */
export async function activateDataflowSchedule(
  user: DataflowUser,
  input: { projectId: string; workflowId: string }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM dataflow_schedule WHERE projectId=? AND workflowId=? AND status<>'deleted' LIMIT 1",
    [input.projectId, input.workflowId]
  );
  const schedule = rows[0];
  if (!schedule) throw new Error("请先保存数据流调度草稿。 ");
  const flow = await getPublishedDataflow(input.projectId, input.workflowId);
  const callbackPath = "/api/scheduled/dataflow";
  const description = `数据流调度：${flow.name}（${input.workflowId.slice(0, 8)}）`;
  if (schedule.scheduleCronTaskUid) {
    await updateHeartbeatJob(
      String(schedule.scheduleCronTaskUid),
      {
        cron: schedule.cronExpression,
        path: callbackPath,
        method: "POST",
        description,
        enable: true,
      },
      ""
    );
  } else {
    const job = await createHeartbeatJob(
      {
        name: `dataflow-${schedule.id}`,
        cron: schedule.cronExpression,
        path: callbackPath,
        method: "POST",
        description,
      },
      ""
    );
    await db().query(
      "UPDATE dataflow_schedule SET scheduleCronTaskUid=? WHERE id=?",
      [job.taskUid, schedule.id]
    );
  }
  await db().query(
    "UPDATE dataflow_schedule SET status='active',updatedAt=NOW() WHERE id=?",
    [schedule.id]
  );
  return { id: schedule.id, status: "active" as const };
}

export async function pauseDataflowSchedule(
  user: DataflowUser,
  input: { projectId: string; workflowId: string }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM dataflow_schedule WHERE projectId=? AND workflowId=? AND status<>'deleted' LIMIT 1",
    [input.projectId, input.workflowId]
  );
  const schedule = rows[0];
  if (!schedule) throw new Error("数据流调度不存在。 ");
  if (schedule.scheduleCronTaskUid)
    await updateHeartbeatJob(
      String(schedule.scheduleCronTaskUid),
      { enable: false },
      ""
    );
  await db().query(
    "UPDATE dataflow_schedule SET status='paused',updatedAt=NOW() WHERE id=?",
    [schedule.id]
  );
  return { id: schedule.id, status: "paused" as const };
}

export async function deleteDataflowSchedule(
  user: DataflowUser,
  input: { projectId: string; workflowId: string }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM dataflow_schedule WHERE projectId=? AND workflowId=? AND status<>'deleted' LIMIT 1",
    [input.projectId, input.workflowId]
  );
  const schedule = rows[0];
  if (!schedule) throw new Error("数据流调度不存在。 ");
  if (schedule.scheduleCronTaskUid)
    await deleteHeartbeatJob(String(schedule.scheduleCronTaskUid), "");
  await db().query(
    "UPDATE dataflow_schedule SET status='deleted',updatedAt=NOW() WHERE id=?",
    [schedule.id]
  );
  return true;
}

/** Mounted before the static/Vite fallthrough. Never trust body fields: the platform task UID selects the schedule. */
export async function handleDataflowScheduleCallback(
  req: Request,
  res: Response
) {
  try {
    let cronUser;
    try {
      cronUser = await sdk.authenticateRequest(req);
    } catch {
      return res.status(403).json({ error: "cron-only" });
    }
    if (!cronUser.isCron || !cronUser.taskUid)
      return res.status(403).json({ error: "cron-only" });
    const [rows] = await db().query<mysql.RowDataPacket[]>(
      `SELECT s.*,p.ownerUserId,u.role AS ownerRole
         FROM dataflow_schedule s JOIN flow_project p ON p.id=s.projectId JOIN users u ON u.id=p.ownerUserId
        WHERE s.scheduleCronTaskUid=? AND s.status='active' LIMIT 1`,
      [cronUser.taskUid]
    );
    const schedule = rows[0];
    if (!schedule) return res.json({ ok: true, skipped: "orphan_or_paused" });
    const scheduleBucket = `${cronUser.taskUid}:${new Date().toISOString().slice(0, 16)}`;
    const [existingRuns] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id,status FROM dataflow_run WHERE workflowId=? AND scheduleBucket=? LIMIT 1",
      [schedule.workflowId, scheduleBucket]
    );
    if (existingRuns[0])
      return res.json({
        ok: true,
        duplicate: true,
        runId: existingRuns[0].id,
        status: existingRuns[0].status,
      });
    let result;
    try {
      result = await runDataflow(
        {
          id: Number(schedule.ownerUserId),
          role: schedule.ownerRole === "admin" ? "admin" : "user",
        },
        {
          projectId: String(schedule.projectId),
          workflowId: String(schedule.workflowId),
          triggerType: "schedule",
          scheduleBucket,
        }
      );
    } catch (error) {
      const [concurrentRuns] = await db().query<mysql.RowDataPacket[]>(
        "SELECT id,status FROM dataflow_run WHERE workflowId=? AND scheduleBucket=? LIMIT 1",
        [schedule.workflowId, scheduleBucket]
      );
      if (concurrentRuns[0])
        return res.json({
          ok: true,
          duplicate: true,
          runId: concurrentRuns[0].id,
          status: concurrentRuns[0].status,
        });
      throw error;
    }
    await db().query(
      "UPDATE dataflow_schedule SET lastTriggeredAt=NOW(),lastRunId=?,updatedAt=NOW() WHERE id=?",
      [result.runId, schedule.id]
    );
    return res.json({ ok: true, runId: result.runId });
  } catch (error) {
    const details = {
      error: error instanceof Error ? error.message : "调度执行失败。",
      timestamp: new Date().toISOString(),
      path: req.path,
    };
    return res.status(500).json(details);
  }
}
