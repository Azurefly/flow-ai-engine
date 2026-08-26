import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { probeSafeHttpEndpoint } from "./workflow-engine";
import { resolveExternalSecret } from "./service-endpoint-service";

type JsonRecord = Record<string, unknown>;
type ResourceKind = "source" | "asset" | "udf" | "tag" | "plugin";
type DataflowUser = ProjectUser;

const id = () => randomBytes(12).toString("base64url");
const dataflowWorkerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
const dataflowLeaseSeconds = Math.max(
  30,
  Number(process.env.DATAFLOW_WORKER_LEASE_SECONDS ?? 120)
);

export type DataflowWorkerFaultPoint = "after_nodes_before_complete";

class DataflowWorkerInjectedCrash extends Error {
  constructor(point: DataflowWorkerFaultPoint) {
    super(`Injected dataflow worker crash at ${point}`);
    this.name = "DataflowWorkerInjectedCrash";
  }
}

export function injectDataflowWorkerFault(point: DataflowWorkerFaultPoint) {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.DATAFLOW_WORKER_FAULT_POINT === point
  )
    throw new DataflowWorkerInjectedCrash(point);
}
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

type DataSourceTestCategory =
  | "policy"
  | "configuration"
  | "dns"
  | "network"
  | "timeout"
  | "authentication"
  | "authorization"
  | "database"
  | "unsupported"
  | "stale_configuration"
  | "internal";

class DataSourceTestFailure extends Error {
  constructor(
    readonly category: DataSourceTestCategory,
    message: string,
    readonly evidence: JsonRecord = {}
  ) {
    super(message);
    this.name = "DataSourceTestFailure";
  }
}

function sourceConfigHash(
  sourceType: string,
  connection: unknown,
  credentialRef: unknown
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceType,
        connection: connection ?? {},
        credentialRef: credentialRef ?? null,
      })
    )
    .digest("hex");
}

function classifyDataSourceTestError(error: unknown): DataSourceTestFailure {
  if (error instanceof DataSourceTestFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout|ETIMEDOUT|请求超时/i.test(message))
    return new DataSourceTestFailure("timeout", "连接测试超时。");
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS/i.test(message))
    return new DataSourceTestFailure("dns", "连接地址无法解析。");
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(message))
    return new DataSourceTestFailure("network", "目标网络连接失败。");
  if (/access denied|authentication|invalid password|1045/i.test(message))
    return new DataSourceTestFailure("authentication", "凭据认证失败。");
  if (
    /command denied|permission denied|not authorized|1142|42000/i.test(message)
  )
    return new DataSourceTestFailure(
      "authorization",
      "账号没有访问数据库的权限。"
    );
  if (/SecretRef|凭据引用|未配置|credential/i.test(message))
    return new DataSourceTestFailure("configuration", "凭据引用无效或未配置。");
  if (/unknown database|database .*does not exist|1049/i.test(message))
    return new DataSourceTestFailure("database", "数据库不存在或不可用。");
  return new DataSourceTestFailure("internal", "连接测试失败。");
}

function connectorAllowedHost(host: string) {
  const allowed = String(process.env.DATA_CONNECTOR_ALLOWED_HOSTS ?? "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(host.toLowerCase());
}

async function executeDataSourceProbe(source: {
  sourceType: string;
  connection: JsonRecord;
  credentialRef: string | null;
}) {
  const connection = source.connection;
  if (source.sourceType === "inline")
    return {
      endpointHost: null,
      evidence: { probe: "inline_metadata", readOnly: true, verified: true },
      latencyMs: 0,
    };
  if (source.sourceType === "file")
    throw new DataSourceTestFailure(
      "unsupported",
      "文件数据源尚未启用服务端受控读取器。"
    );
  const endpoint = String(connection.endpoint ?? "").trim();
  if (!endpoint)
    throw new DataSourceTestFailure("configuration", "连接地址不能为空。");
  if (source.sourceType === "api") {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new DataSourceTestFailure(
        "configuration",
        "API 地址不是合法 URL。"
      );
    }
    const headers: Record<string, string> = {};
    if (source.credentialRef) {
      const token = resolveExternalSecret(source.credentialRef);
      headers[String(connection.authHeaderName ?? "Authorization")] =
        `${String(connection.authScheme ?? "Bearer")} ${token}`;
    }
    let probe;
    try {
      probe = await probeSafeHttpEndpoint(url.toString(), headers);
    } catch (error) {
      throw classifyDataSourceTestError(error);
    }
    if (probe.status === 401)
      throw new DataSourceTestFailure("authentication", "API 凭据认证失败.", {
        httpStatus: probe.status,
      });
    if (probe.status === 403)
      throw new DataSourceTestFailure(
        "authorization",
        "API 账号没有访问权限。",
        { httpStatus: probe.status }
      );
    if (probe.status < 200 || probe.status >= 300)
      throw new DataSourceTestFailure(
        "network",
        `API 探测返回 HTTP ${probe.status}。`,
        { httpStatus: probe.status }
      );
    return {
      endpointHost: probe.host,
      latencyMs: probe.latencyMs,
      evidence: {
        probe: "http_get",
        httpStatus: probe.status,
        responseBytes: probe.bytes,
        readOnly: true,
        verified: true,
      },
    };
  }
  if (source.sourceType === "jdbc") {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new DataSourceTestFailure(
        "configuration",
        "JDBC 地址不是合法 URL。"
      );
    }
    if (url.protocol !== "mysql:")
      throw new DataSourceTestFailure(
        "configuration",
        "JDBC 数据源测试目前仅支持 mysql:// 地址。"
      );
    const host = url.hostname.toLowerCase();
    if (!connectorAllowedHost(host))
      throw new DataSourceTestFailure(
        "policy",
        "JDBC 主机不在 DATA_CONNECTOR_ALLOWED_HOSTS 白名单中。",
        { host }
      );
    let credentials: JsonRecord = {};
    if (source.credentialRef) {
      const secret = resolveExternalSecret(source.credentialRef);
      try {
        credentials = JSON.parse(secret) as JsonRecord;
      } catch {
        throw new DataSourceTestFailure(
          "configuration",
          "JDBC SecretRef 必须是 JSON 凭据对象。",
          { host }
        );
      }
    }
    const startedAt = Date.now();
    let connectionHandle: mysql.Connection | undefined;
    try {
      connectionHandle = await mysql.createConnection({
        host,
        port: Number(url.port || 3306),
        database: url.pathname.replace(/^\//, "") || undefined,
        user: String(credentials.username ?? connection.username ?? ""),
        password: String(credentials.password ?? ""),
        connectTimeout: 8_000,
        ssl: connection.ssl === true ? {} : undefined,
      });
      await connectionHandle.query("SELECT 1 AS ok");
    } catch (error) {
      throw classifyDataSourceTestError(error);
    } finally {
      await connectionHandle?.end().catch(() => undefined);
    }
    return {
      endpointHost: host,
      latencyMs: Date.now() - startedAt,
      evidence: {
        probe: "mysql_select_1",
        host,
        port: Number(url.port || 3306),
        readOnly: true,
        verified: true,
      },
    };
  }
  throw new DataSourceTestFailure(
    "unsupported",
    `数据源类型 ${source.sourceType} 尚未启用测试器。`
  );
}

type ClaimedDataSourceTest = {
  id: string;
  projectId: string;
  sourceId: string;
  sourceType: string;
  connection: JsonRecord;
  credentialRef: string | null;
  configHash: string;
  leaseToken: string;
  attempt: number;
  maxAttempts: number;
  requestId: string | null;
};

async function claimDataSourceTest(
  requestedJobId?: string
): Promise<ClaimedDataSourceTest | null> {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    // An expired lease at the attempt limit can never be reclaimed. Finalize it
    // before selecting work so a crashed worker cannot leave a permanent lease.
    await connection.query(
      "UPDATE data_source_test_run SET status='failed',errorCategory='internal',errorJson=?,leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW() WHERE status='leased' AND leaseExpiresAt<NOW() AND attempt>=maxAttempts",
      [
        JSON.stringify({
          message: "数据源测试 Worker 租约过期且已达到最大尝试次数。",
        }),
      ]
    );
    const where = [
      "t.attempt<t.maxAttempts",
      "((t.status='queued' AND t.availableAt<=NOW()) OR (t.status='leased' AND t.leaseExpiresAt<NOW()))",
    ];
    const params: unknown[] = [];
    if (requestedJobId) {
      where.push("t.id=?");
      params.push(requestedJobId);
    }
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT t.id,t.projectId,t.sourceId,t.sourceType,t.configHash,t.attempt,t.maxAttempts,t.requestId,
              t.status,s.connectionJson,s.credentialRef
         FROM data_source_test_run t JOIN data_source s ON s.id=t.sourceId AND s.projectId=t.projectId
        WHERE ${where.join(" AND ")}
        ORDER BY t.availableAt,t.createdAt LIMIT 1 FOR UPDATE SKIP LOCKED`,
      params
    );
    const row = rows[0];
    if (!row) {
      await connection.commit();
      return null;
    }
    const token = randomUUID().replaceAll("-", "").slice(0, 48);
    const [claimed] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE data_source_test_run SET status='leased',attempt=attempt+1,leaseToken=?,leaseExpiresAt=DATE_ADD(NOW(),INTERVAL 60 SECOND),workerId=?,startedAt=COALESCE(startedAt,NOW())
        WHERE id=? AND ((status='queued' AND availableAt<=NOW()) OR (status='leased' AND leaseExpiresAt<NOW()))`,
      [token, dataflowWorkerId, row.id]
    );
    if (!claimed.affectedRows) {
      await connection.rollback();
      return null;
    }
    await connection.commit();
    return {
      id: String(row.id),
      projectId: String(row.projectId),
      sourceId: String(row.sourceId),
      sourceType: String(row.sourceType),
      connection: parseJson(row.connectionJson, {}) as JsonRecord,
      credentialRef: row.credentialRef ? String(row.credentialRef) : null,
      configHash: String(row.configHash),
      leaseToken: token,
      attempt: Number(row.attempt ?? 0) + 1,
      maxAttempts: Number(row.maxAttempts ?? 2),
      requestId: row.requestId ? String(row.requestId) : null,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function processDataSourceTest(job: ClaimedDataSourceTest) {
  const startedAt = Date.now();
  try {
    const result = await executeDataSourceProbe(job);
    const connection = await db().getConnection();
    try {
      await connection.beginTransaction();
      const [sourceRows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT connectionJson,credentialRef,sourceType FROM data_source WHERE id=? AND projectId=? LIMIT 1 FOR UPDATE",
        [job.sourceId, job.projectId]
      );
      const source = sourceRows[0];
      const currentHash = source
        ? sourceConfigHash(
            source.sourceType,
            parseJson(source.connectionJson, {}),
            source.credentialRef
          )
        : "";
      if (!source || currentHash !== job.configHash)
        throw new DataSourceTestFailure(
          "stale_configuration",
          "数据源配置在测试期间发生变化。",
          { configChanged: true }
        );
      const [updated] = await connection.query<mysql.ResultSetHeader>(
        "UPDATE data_source_test_run SET status='success',endpointHost=?,evidenceJson=?,errorCategory=NULL,errorJson=NULL,latencyMs=?,leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW() WHERE id=? AND status='leased' AND leaseToken=?",
        [
          result.endpointHost,
          JSON.stringify(result.evidence),
          result.latencyMs ?? Date.now() - startedAt,
          job.id,
          job.leaseToken,
        ]
      );
      if (!updated.affectedRows) throw new Error("数据源测试 Job 租约已失效。");
      await connection.query(
        "UPDATE data_source SET status='verified',lastTestedAt=NOW(),updatedAt=NOW() WHERE id=? AND projectId=?",
        [job.sourceId, job.projectId]
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    const failure = classifyDataSourceTestError(error);
    const retryable =
      ["dns", "network", "timeout"].includes(failure.category) &&
      job.attempt < job.maxAttempts;
    const connection = await db().getConnection();
    try {
      await connection.beginTransaction();
      const [updated] = await connection.query<mysql.ResultSetHeader>(
        `UPDATE data_source_test_run SET status=?,errorCategory=?,errorJson=?,availableAt=IF(?='queued',DATE_ADD(NOW(),INTERVAL 5 SECOND),availableAt),leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=IF(?='failed',NOW(),NULL),latencyMs=? WHERE id=? AND status='leased' AND leaseToken=?`,
        [
          retryable ? "queued" : "failed",
          failure.category,
          JSON.stringify({ message: failure.message, ...failure.evidence }),
          retryable ? "queued" : "failed",
          retryable ? "queued" : "failed",
          Date.now() - startedAt,
          job.id,
          job.leaseToken,
        ]
      );
      if (!updated.affectedRows)
        throw new Error("数据源测试失败处理时租约已失效。");
      await connection.commit();
    } catch (releaseError) {
      await connection.rollback();
      throw releaseError;
    } finally {
      connection.release();
    }
    return false;
  }
}

export async function runDataSourceTestJobOnce(requestedJobId?: string) {
  const job = await claimDataSourceTest(requestedJobId);
  if (!job) return false;
  await processDataSourceTest(job);
  return true;
}

export async function testDataSource(
  user: DataflowUser,
  input: { projectId: string; sourceId: string }
) {
  await requireProjectAccess(user, input.projectId, "edit");
  const [sources] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,projectId,sourceType,connectionJson,credentialRef FROM data_source WHERE id=? AND projectId=? LIMIT 1",
    [input.sourceId, input.projectId]
  );
  const source = sources[0];
  if (!source) throw new Error("数据源不存在或不属于当前项目。");
  const configHash = sourceConfigHash(
    source.sourceType,
    parseJson(source.connectionJson, {}),
    source.credentialRef
  );
  const testId = id();
  await db().query(
    "INSERT INTO data_source_test_run (id,projectId,sourceId,sourceType,status,configHash,maxAttempts,requestId,triggeredByUserId) VALUES (?,?,?,?, 'queued',?,?,?,?)",
    [
      testId,
      input.projectId,
      input.sourceId,
      source.sourceType,
      configHash,
      2,
      currentRequestId() ?? null,
      user.id,
    ]
  );
  // Try this exact job once for fast feedback; the process worker remains the
  // durable fallback if another worker already claimed it or the probe is slow.
  await runDataSourceTestJobOnce(testId);
  const [runs] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,status,errorCategory,evidenceJson,errorJson,endpointHost,latencyMs,createdAt,startedAt,finishedAt FROM data_source_test_run WHERE id=? LIMIT 1",
    [testId]
  );
  const run = runs[0];
  return {
    ...run,
    evidence: parseJson(run?.evidenceJson, null),
    error: parseJson(run?.errorJson, null),
    evidenceJson: undefined,
    errorJson: undefined,
  };
}

export async function listDataSourceTests(
  user: DataflowUser,
  input: { projectId: string; sourceId?: string; limit?: number }
) {
  await requireProjectAccess(user, input.projectId, "view");
  const clauses = ["t.projectId=?"];
  const params: unknown[] = [input.projectId];
  if (input.sourceId) {
    clauses.push("t.sourceId=?");
    params.push(input.sourceId);
  }
  params.push(Math.min(Math.max(input.limit ?? 30, 1), 100));
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.id,t.sourceId,s.name AS sourceName,t.sourceType,t.status,t.errorCategory,t.endpointHost,t.evidenceJson,t.errorJson,t.latencyMs,t.requestId,t.createdAt,t.startedAt,t.finishedAt
       FROM data_source_test_run t JOIN data_source s ON s.id=t.sourceId
      WHERE ${clauses.join(" AND ")} ORDER BY t.createdAt DESC LIMIT ?`,
    params
  );
  return rows.map(row => ({
    ...row,
    evidence: parseJson(row.evidenceJson, null),
    error: parseJson(row.errorJson, null),
    evidenceJson: undefined,
    errorJson: undefined,
  }));
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

function assertReadOnlySql(statement: string) {
  const normalized = statement.trim();
  if (
    !/^select\b/i.test(normalized) ||
    /;|\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|call|load)\b/i.test(
      normalized
    )
  )
    throw new Error("SQL 节点仅支持单条只读 SELECT 语句。 ");
  if (
    /into\s+(outfile|dumpfile)|\bfor\s+update\b|lock\s+in\s+share\s+mode/i.test(
      normalized
    )
  )
    throw new Error("SQL 节点禁止文件写出。 ");
  return normalized;
}

async function loadVerifiedConnector(projectId: string, sourceId: string) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,sourceType,status,connectionJson,credentialRef FROM data_source WHERE id=? AND projectId=? LIMIT 1",
    [sourceId, projectId]
  );
  const source = rows[0];
  if (!source) throw new Error("数据源不存在或不属于当前项目。 ");
  if (source.sourceType !== "inline" && source.status !== "verified")
    throw new Error("数据源尚未通过连接测试，禁止执行读取。 ");
  const connection = parseJson(source.connectionJson, {}) as JsonRecord;
  return {
    sourceType: String(source.sourceType),
    status: String(source.status),
    connection,
    credentialRef: source.credentialRef ? String(source.credentialRef) : null,
  };
}

async function withMysqlConnector<T>(
  source: { connection: JsonRecord; credentialRef: string | null },
  run: (connection: mysql.Connection) => Promise<T>
) {
  const endpoint = String(source.connection.endpoint ?? "").trim();
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("MySQL 数据源地址不是合法 URL。 ");
  }
  if (url.protocol !== "mysql:")
    throw new Error("当前仅支持 mysql:// 数据源。 ");
  const host = url.hostname.toLowerCase();
  if (!connectorAllowedHost(host))
    throw new Error("MySQL 主机不在 DATA_CONNECTOR_ALLOWED_HOSTS 白名单中。 ");
  let credentials: JsonRecord = {};
  if (source.credentialRef) {
    const secret = resolveExternalSecret(source.credentialRef);
    try {
      credentials = JSON.parse(secret) as JsonRecord;
    } catch {
      throw new Error("MySQL SecretRef 必须是 JSON 凭据对象。 ");
    }
  }
  const handle = await mysql.createConnection({
    host,
    port: Number(url.port || 3306),
    database: url.pathname.replace(/^\//, "") || undefined,
    user: String(credentials.username ?? source.connection.username ?? ""),
    password: String(credentials.password ?? ""),
    connectTimeout: 8_000,
    ssl: source.connection.ssl === true ? {} : undefined,
  });
  try {
    return await run(handle);
  } finally {
    await handle.end().catch(() => undefined);
  }
}

async function readConnectorAsset(
  projectId: string,
  assetId: string,
  options: { columns?: string[]; limit?: number } = {}
) {
  const [assets] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,name,assetType,schemaJson,sampleJson,sourceId,status FROM data_asset WHERE id=? AND projectId=? AND status='active' LIMIT 1",
    [assetId, projectId]
  );
  const asset = assets[0];
  if (!asset) throw new Error("数据资源不存在、已停用或不属于当前项目。 ");
  if (!asset.sourceId)
    return {
      rows: normalizeRows(parseJson(asset.sampleJson, [])),
      schema: parseJson(asset.schemaJson, []),
    };
  const source = await loadVerifiedConnector(projectId, String(asset.sourceId));
  if (source.sourceType === "inline")
    return {
      rows: normalizeRows(parseJson(asset.sampleJson, [])),
      schema: parseJson(asset.schemaJson, []),
    };
  if (source.sourceType !== "jdbc")
    throw new Error(
      `数据源类型 ${source.sourceType} 尚未启用数据读取 Connector。`
    );
  const identifier = String(asset.name ?? "");
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(identifier))
    throw new Error("MySQL 表名必须是安全标识符。 ");
  const columns = (options.columns ?? []).map(String).filter(Boolean);
  if (columns.some(column => !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(column)))
    throw new Error("Source 节点列名必须是安全标识符。 ");
  const projection = columns.length
    ? columns.map(column => `\`${column}\``).join(",")
    : "*";
  const limit = Math.min(
    Math.max(Math.trunc(Number(options.limit ?? 200)), 1),
    1_000
  );
  const result = await withMysqlConnector(source, connection =>
    connection.query<mysql.RowDataPacket[]>(
      `SELECT ${projection} FROM \`${identifier}\` LIMIT ?`,
      [limit]
    )
  );
  return {
    rows: normalizeRows(result[0]),
    schema: parseJson(asset.schemaJson, []),
  };
}

async function executeSqlConnector(
  projectId: string,
  sourceId: string,
  statement: string,
  parameters: JsonRecord = {},
  maxRows = 1_000
) {
  const safeStatement = assertReadOnlySql(statement);
  const source = await loadVerifiedConnector(projectId, sourceId);
  if (source.sourceType !== "jdbc")
    throw new Error("SQL Connector 目前仅支持已验证的 MySQL 数据源。 ");
  const values: unknown[] = [];
  const bound = safeStatement.replace(
    /:([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, name: string) => {
      if (!Object.prototype.hasOwnProperty.call(parameters, name))
        throw new Error(`SQL 参数 ${name} 未提供。`);
      values.push(parameters[name]);
      return "?";
    }
  );
  const limit = Math.min(Math.max(Math.trunc(Number(maxRows)), 1), 1_000);
  const result = await withMysqlConnector(source, connection =>
    connection.query<mysql.RowDataPacket[]>(
      `SELECT * FROM (${bound}) AS _flow_query LIMIT ${limit}`,
      values
    )
  );
  return normalizeRows(result[0]);
}

export function compileDataflowExecutionPlan(definition: unknown) {
  const compiled = compileWorkflowDefinition(definition, { flowType: "data" });
  if (!compiled.plan.topologicalOrder)
    throw new Error("数据流执行计划必须是无环 DAG。");
  return { plan: compiled.plan, planHash: compiled.planHash };
}

type DataflowJobOwnership = {
  id: string;
  leaseToken: string;
};

function inferDatasetSchema(output: JsonRecord) {
  if (Array.isArray(output.schema)) return output.schema;
  const rows = normalizeRows(output.rows);
  const sample = rows[0] ?? {};
  return Object.keys(sample)
    .sort()
    .map(name => ({
      name,
      type:
        sample[name] === null
          ? "null"
          : Array.isArray(sample[name])
            ? "array"
            : typeof sample[name],
    }));
}

async function assertDataflowJobLease(
  connection: mysql.PoolConnection,
  ownership: DataflowJobOwnership
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id FROM dataflow_run_job WHERE id=? AND status='leased' AND leaseToken=? AND leaseExpiresAt>NOW() LIMIT 1 FOR UPDATE",
    [ownership.id, ownership.leaseToken]
  );
  if (!rows[0]) throw new Error("数据流 Job 租约已失效，拒绝提交节点结果。");
}

async function loadDataflowCheckpoint(runId: string) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT nr.nodeId,nr.nodeType,nr.sequenceNo,nr.outputJson,a.id AS artifactId
       FROM dataflow_node_run nr
       JOIN dataflow_dataset_artifact a ON a.nodeRunId=nr.id
      WHERE nr.runId=? AND nr.status='success'
      ORDER BY nr.sequenceNo`,
    [runId]
  );
  const outputs = new Map<string, JsonRecord>();
  const artifacts = new Map<string, string>();
  const executed: JsonRecord[] = [];
  for (const row of rows) {
    const nodeId = String(row.nodeId);
    const output = parseJson(row.outputJson, {}) as JsonRecord;
    outputs.set(nodeId, output);
    artifacts.set(nodeId, String(row.artifactId));
    executed.push({
      nodeId,
      nodeType: row.nodeType,
      rowCount: normalizeRows(output.rows).length,
      output,
      artifactId: String(row.artifactId),
      checkpointRestored: true,
    });
  }
  return { outputs, artifacts, executed };
}

async function runDataflowDefinition(
  projectId: string,
  executionPlan: WorkflowExecutionPlan,
  runId: string,
  requestId: string | null,
  ownership: DataflowJobOwnership
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
  const checkpoint = await loadDataflowCheckpoint(runId);
  const outputs = checkpoint.outputs;
  const artifactByNode = checkpoint.artifacts;
  const executed = checkpoint.executed;
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (outputs.has(nodeId)) continue;
    const node = byId.get(nodeId)!;
    const inputs = (incoming.get(nodeId) ?? [])
      .map(parentId => outputs.get(parentId))
      .filter(Boolean) as JsonRecord[];
    const config = nodeConfig(node);
    const nodeStartedAt = Date.now();
    const sequenceNo = executionPlan.topologicalOrder.indexOf(nodeId);
    const inputArtifactIds = (incoming.get(nodeId) ?? [])
      .map(parentId => artifactByNode.get(parentId))
      .filter(Boolean) as string[];
    const startConnection = await db().getConnection();
    try {
      await startConnection.beginTransaction();
      await assertDataflowJobLease(startConnection, ownership);
      await startConnection.query(
        `INSERT INTO dataflow_node_run
          (id,runId,nodeId,sequenceNo,nodeType,status,attempt,inputJson,inputArtifactsJson,jobLeaseToken,requestId,startedAt)
         VALUES (?,?,?,?,?,'running',1,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE status='running',attempt=attempt+1,inputJson=VALUES(inputJson),inputArtifactsJson=VALUES(inputArtifactsJson),outputJson=NULL,outputArtifactsJson=NULL,metricsJson=NULL,errorJson=NULL,rowCount=NULL,jobLeaseToken=VALUES(jobLeaseToken),requestId=VALUES(requestId),startedAt=NOW(),finishedAt=NULL,durationMs=NULL`,
        [
          id(),
          runId,
          nodeId,
          sequenceNo,
          String(node.type),
          JSON.stringify(inputs),
          JSON.stringify(inputArtifactIds),
          ownership.leaseToken,
          requestId,
        ]
      );
      await startConnection.commit();
    } catch (error) {
      await startConnection.rollback();
      throw error;
    } finally {
      startConnection.release();
    }
    let output: JsonRecord;
    try {
      if (["start", "begin"].includes(String(node.type)))
        output = { rows: rowsFromInput(inputs), stage: "start" };
      else if (["source", "data_source", "table"].includes(String(node.type))) {
        const assetId = String(config.assetId ?? "");
        const asset = await readConnectorAsset(projectId, assetId, {
          columns: Array.isArray(config.columns)
            ? config.columns.map(String)
            : undefined,
          limit: Number(config.limit ?? 200),
        });
        output = {
          assetId,
          rows: asset.rows,
          schema: asset.schema,
          execution: "connector_read",
        };
      } else if (String(node.type) === "filter") {
        const rows = rowsFromInput(inputs);
        const field = String(config.filterField ?? "").trim();
        const expected = config.filterValue;
        const operator = String(config.operator ?? "equals");
        output = {
          rows: rows.filter(row => {
            const actual = row[field];
            if (operator === "exists")
              return actual !== undefined && actual !== null;
            if (operator === "notEquals")
              return String(actual) !== String(expected);
            if (operator === "contains")
              return String(actual ?? "").includes(String(expected ?? ""));
            if (operator === "greaterThan")
              return Number(actual) > Number(expected);
            if (operator === "lessThan")
              return Number(actual) < Number(expected);
            return String(actual) === String(expected);
          }),
          operation: "filter",
        };
      } else if (
        String(node.type) === "map" ||
        String(node.type) === "project"
      ) {
        let rows = rowsFromInput(inputs);
        const columns = Array.isArray(config.columns)
          ? config.columns.map(column => String(column))
          : [];
        const mappings = Array.isArray(config.fields) ? config.fields : [];
        if (mappings.length)
          rows = rows.map(row =>
            Object.fromEntries(
              mappings
                .filter(item => item && typeof item === "object")
                .map((item: any) => [
                  String(item.target ?? item.source),
                  row[String(item.source)],
                ])
            )
          );
        else if (columns.length)
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
      } else if (String(node.type) === "derive") {
        const rows = rowsFromInput(inputs);
        const fields = Array.isArray(config.fields) ? config.fields : [];
        output = {
          rows: rows.map(row => {
            const next = { ...row };
            for (const item of fields) {
              if (!item || typeof item !== "object") continue;
              const field = item as JsonRecord;
              const name = String(field.name ?? "").trim();
              const expression = String(field.expression ?? "").trim();
              if (!name || !expression) continue;
              const ref = expression.match(
                /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/
              );
              if (ref) next[name] = row[ref[1]!];
              else if (/^-?\d+(?:\.\d+)?$/.test(expression))
                next[name] = Number(expression);
              else if (/^(true|false)$/i.test(expression))
                next[name] = expression.toLowerCase() === "true";
              else next[name] = expression;
            }
            return next;
          }),
          operation: "derive",
        };
      } else if (String(node.type) === "join") {
        const left = normalizeRows(inputs[0]?.rows ?? []);
        const right = normalizeRows(inputs[1]?.rows ?? []);
        const leftKeys = Array.isArray(config.leftKeys)
          ? config.leftKeys.map(String)
          : [];
        const rightKeys = Array.isArray(config.rightKeys)
          ? config.rightKeys.map(String)
          : [];
        const index = new Map<string, JsonRecord[]>();
        for (const row of right) {
          const key = JSON.stringify(rightKeys.map(field => row[field]));
          const bucket = index.get(key) ?? [];
          bucket.push(row);
          index.set(key, bucket);
        }
        const rows: JsonRecord[] = [];
        for (const row of left) {
          const matches =
            index.get(JSON.stringify(leftKeys.map(field => row[field]))) ?? [];
          if (!matches.length && config.kind === "left") rows.push({ ...row });
          for (const match of matches)
            rows.push({
              ...row,
              ...Object.fromEntries(
                Object.entries(match).map(([key, value]) => [
                  Object.prototype.hasOwnProperty.call(row, key)
                    ? `${String(config.rightPrefix ?? "right_")}${key}`
                    : key,
                  value,
                ])
              ),
            });
        }
        output = { rows, operation: "join" };
      } else if (String(node.type) === "union") {
        let rows = rowsFromInput(inputs);
        if (String(config.mode) === "distinct") {
          const seen = new Set<string>();
          rows = rows.filter(row => {
            const key = JSON.stringify(row);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        output = { rows, operation: "union" };
      } else if (String(node.type) === "aggregate") {
        const groupBy = Array.isArray(config.groupBy)
          ? config.groupBy.map(String)
          : [];
        const metrics = Array.isArray(config.metrics) ? config.metrics : [];
        const groups = new Map<string, JsonRecord[]>();
        for (const row of rowsFromInput(inputs)) {
          const key = JSON.stringify(groupBy.map(field => row[field]));
          const bucket = groups.get(key) ?? [];
          bucket.push(row);
          groups.set(key, bucket);
        }
        output = {
          rows: Array.from(groups.values()).map((bucket: JsonRecord[]) => {
            const out: JsonRecord = {};
            for (const field of groupBy) out[field] = bucket[0]?.[field];
            for (const metric of metrics) {
              const item = metric as JsonRecord;
              const field = String(item.field ?? "");
              const values = bucket
                .map((row: JsonRecord) => Number(row[field]))
                .filter(Number.isFinite);
              const op = String(item.operation ?? "count");
              out[String(item.name ?? field ?? "metric")] =
                op === "count"
                  ? bucket.length
                  : op === "sum"
                    ? values.reduce((a: number, b: number) => a + b, 0)
                    : op === "min"
                      ? Math.min(...values)
                      : Math.max(...values);
            }
            return out;
          }),
          operation: "aggregate",
        };
      } else if (String(node.type) === "deduplicate") {
        const keys = Array.isArray(config.keys) ? config.keys.map(String) : [];
        const seen = new Set<string>();
        output = {
          rows: rowsFromInput(inputs).filter(row => {
            const key = JSON.stringify(keys.map(field => row[field]));
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
          operation: "deduplicate",
        };
      } else if (String(node.type) === "sort") {
        const fields = Array.isArray(config.fields) ? config.fields : [];
        const rows = [...rowsFromInput(inputs)];
        rows.sort((left, right) => {
          for (const item of fields) {
            const field = String((item as JsonRecord)?.field ?? item);
            const direction =
              String((item as JsonRecord)?.direction ?? "asc").toLowerCase() ===
              "desc"
                ? -1
                : 1;
            const a = left[field];
            const b = right[field];
            if (a === b) continue;
            return (
              (a === undefined || a === null
                ? -1
                : b === undefined || b === null
                  ? 1
                  : a < b
                    ? -1
                    : 1) * direction
            );
          }
          return 0;
        });
        output = { rows, operation: "sort" };
      } else if (String(node.type) === "transform") {
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
        const datasourceId = String(
          config.datasourceId ?? config.sourceId ?? ""
        );
        if (!datasourceId) throw new Error("SQL 节点缺少 datasourceId。 ");
        const rows = await executeSqlConnector(
          projectId,
          datasourceId,
          statement,
          (config.parameters ?? {}) as JsonRecord,
          Number(config.maxRows ?? 1_000)
        );
        output = {
          rows,
          statement,
          execution: "mysql_read_connector",
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
      const outputRows = normalizeRows(output.rows);
      const schema = inferDatasetSchema(output);
      const schemaHash = createHash("sha256")
        .update(JSON.stringify(schema))
        .digest("hex");
      const serializedOutput = JSON.stringify(output);
      const artifactId = id();
      const finishConnection = await db().getConnection();
      try {
        await finishConnection.beginTransaction();
        await assertDataflowJobLease(finishConnection, ownership);
        const [nodeRows] = await finishConnection.query<mysql.RowDataPacket[]>(
          "SELECT id,attempt FROM dataflow_node_run WHERE runId=? AND nodeId=? AND status='running' AND jobLeaseToken=? LIMIT 1 FOR UPDATE",
          [runId, nodeId, ownership.leaseToken]
        );
        const nodeRun = nodeRows[0];
        if (!nodeRun) throw new Error("数据流节点 Attempt 已失去所有权。");
        await finishConnection.query(
          `INSERT INTO dataflow_dataset_artifact
            (id,runId,nodeRunId,nodeId,schemaJson,schemaHash,storageRef,format,dataJson,partitionJson,rowCount,byteCount,watermarkJson,sampleJson)
           VALUES (?,?,?,?,?,?,?,'inline_json',?,NULL,?,?,NULL,?)`,
          [
            artifactId,
            runId,
            nodeRun.id,
            nodeId,
            JSON.stringify(schema),
            schemaHash,
            `inline://dataflow/${runId}/${nodeId}`,
            serializedOutput,
            outputRows.length,
            Buffer.byteLength(serializedOutput, "utf8"),
            JSON.stringify(outputRows.slice(0, 20)),
          ]
        );
        for (const sourceArtifactId of inputArtifactIds) {
          await finishConnection.query(
            "INSERT IGNORE INTO dataflow_lineage_edge (id,runId,sourceArtifactId,targetArtifactId,nodeRunId,columnMappingJson) VALUES (?,?,?,?,?,?)",
            [
              id(),
              runId,
              sourceArtifactId,
              artifactId,
              nodeRun.id,
              JSON.stringify({ mode: "input_dependency" }),
            ]
          );
        }
        const metrics = {
          rowCount: outputRows.length,
          byteCount: Buffer.byteLength(serializedOutput, "utf8"),
          durationMs: Date.now() - nodeStartedAt,
          attempt: Number(nodeRun.attempt),
        };
        const [completedNode] =
          await finishConnection.query<mysql.ResultSetHeader>(
            "UPDATE dataflow_node_run SET status='success',outputJson=?,outputArtifactsJson=?,metricsJson=?,rowCount=?,finishedAt=NOW(),durationMs=? WHERE id=? AND status='running' AND jobLeaseToken=?",
            [
              serializedOutput,
              JSON.stringify([artifactId]),
              JSON.stringify(metrics),
              outputRows.length,
              metrics.durationMs,
              nodeRun.id,
              ownership.leaseToken,
            ]
          );
        if (!completedNode.affectedRows)
          throw new Error("数据流节点完成时 Attempt 已失去所有权。");
        const checkpointJson = {
          completedNodeIds: [...Array.from(outputs.keys()), nodeId],
          artifacts: Object.fromEntries([
            ...Array.from(artifactByNode.entries()),
            [nodeId, artifactId],
          ]),
          updatedAt: new Date().toISOString(),
        };
        const [checkpointed] =
          await finishConnection.query<mysql.ResultSetHeader>(
            "UPDATE dataflow_run SET checkpointJson=? WHERE id=? AND status='running'",
            [JSON.stringify(checkpointJson), runId]
          );
        if (!checkpointed.affectedRows)
          throw new Error("数据流运行状态已改变，Checkpoint 未提交。");
        await finishConnection.commit();
      } catch (error) {
        await finishConnection.rollback();
        throw error;
      } finally {
        finishConnection.release();
      }
      outputs.set(nodeId, output);
      artifactByNode.set(nodeId, artifactId);
      executed.push({
        nodeId,
        nodeType: node.type,
        rowCount: outputRows.length,
        output,
        artifactId,
      });
    } catch (error) {
      await db().query(
        "UPDATE dataflow_node_run SET status='failed',errorJson=?,finishedAt=NOW(),durationMs=? WHERE runId=? AND nodeId=? AND status='running' AND jobLeaseToken=?",
        [
          JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
          }),
          Date.now() - nodeStartedAt,
          runId,
          nodeId,
          ownership.leaseToken,
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
  const terminalArtifacts = nodes
    .filter((node: any) => !(outgoing.get(String(node.id)) ?? []).length)
    .map((node: any) => artifactByNode.get(String(node.id)))
    .filter(Boolean);
  return { terminals: terminal, terminalArtifacts, nodes: executed };
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
      job.requestId,
      { id: job.id, leaseToken: job.leaseToken }
    );
    injectDataflowWorkerFault("after_nodes_before_complete");
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
    if (error instanceof DataflowWorkerInjectedCrash) throw error;
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
    checkpoint: parseJson(row.checkpointJson, null),
    watermarkInput: parseJson(row.watermarkInputJson, null),
    watermarkOutput: parseJson(row.watermarkOutputJson, null),
    inputJson: undefined,
    outputJson: undefined,
    errorJson: undefined,
    checkpointJson: undefined,
    watermarkInputJson: undefined,
    watermarkOutputJson: undefined,
  }));
}

export async function getDataflowRunLineage(
  user: DataflowUser,
  input: { projectId: string; runId: string }
) {
  await requireProjectAccess(user, input.projectId, "view");
  const [runs] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,status,checkpointJson,watermarkInputJson,watermarkOutputJson FROM dataflow_run WHERE id=? AND projectId=? LIMIT 1",
    [input.runId, input.projectId]
  );
  if (!runs[0]) throw new Error("数据流运行不存在或不属于当前项目。");
  const [artifacts, lineage] = await Promise.all([
    db().query<mysql.RowDataPacket[]>(
      `SELECT a.id,a.nodeId,a.nodeRunId,a.schemaJson,a.schemaHash,a.storageRef,a.format,a.partitionJson,a.rowCount,a.byteCount,a.watermarkJson,a.sampleJson,a.expiresAt,a.createdAt,n.sequenceNo,n.nodeType,n.attempt
         FROM dataflow_dataset_artifact a JOIN dataflow_node_run n ON n.id=a.nodeRunId
        WHERE a.runId=? ORDER BY n.sequenceNo`,
      [input.runId]
    ),
    db().query<mysql.RowDataPacket[]>(
      `SELECT l.id,l.sourceArtifactId,l.targetArtifactId,l.nodeRunId,l.columnMappingJson,l.createdAt,
              source.nodeId AS sourceNodeId,target.nodeId AS targetNodeId
         FROM dataflow_lineage_edge l
         JOIN dataflow_dataset_artifact source ON source.id=l.sourceArtifactId
         JOIN dataflow_dataset_artifact target ON target.id=l.targetArtifactId
        WHERE l.runId=? ORDER BY l.createdAt,l.id`,
      [input.runId]
    ),
  ]);
  const run = runs[0];
  return {
    run: {
      id: run.id,
      status: run.status,
      checkpoint: parseJson(run.checkpointJson, null),
      watermarkInput: parseJson(run.watermarkInputJson, null),
      watermarkOutput: parseJson(run.watermarkOutputJson, null),
    },
    artifacts: artifacts[0].map(row => ({
      ...row,
      schema: parseJson(row.schemaJson, []),
      partition: parseJson(row.partitionJson, null),
      watermark: parseJson(row.watermarkJson, null),
      sample: parseJson(row.sampleJson, []),
      schemaJson: undefined,
      partitionJson: undefined,
      watermarkJson: undefined,
      sampleJson: undefined,
    })),
    lineage: lineage[0].map(row => ({
      ...row,
      columnMapping: parseJson(row.columnMappingJson, null),
      columnMappingJson: undefined,
    })),
  };
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
