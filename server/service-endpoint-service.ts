import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { join } from "node:path";
import { getSharedPool } from "./db";
import { recordAuthorizationAudit } from "./iam-service";
import { getProjectAccess, type ProjectUser } from "./project-service";

const db = () => getSharedPool();

const REF_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SECRET_REF = /^env:FLOW_SECRET_[A-Z0-9_]{2,128}$/;
export const SERVICE_ENDPOINT_TARGET_ENVIRONMENTS = [
  "development",
  "test",
  "staging",
  "production",
] as const;
export type ServiceEndpointTargetEnvironment =
  (typeof SERVICE_ENDPOINT_TARGET_ENVIRONMENTS)[number];
const SERVICE_ENDPOINT_TARGET_ENVIRONMENT_SET = new Set<string>(
  SERVICE_ENDPOINT_TARGET_ENVIRONMENTS
);

function assertTargetEnvironment(
  targetEnvironment: string
): asserts targetEnvironment is ServiceEndpointTargetEnvironment {
  if (!SERVICE_ENDPOINT_TARGET_ENVIRONMENT_SET.has(targetEnvironment))
    throw new Error("必须选择开发、测试、预发布或生产目标环境。");
}

export function normalizeServiceEndpointDefinition(input: {
  refCode: string;
  baseUrl: string;
  targetEnvironment: ServiceEndpointTargetEnvironment;
  secretRef?: string | null;
  authHeaderName?: string | null;
  authScheme?: string | null;
}) {
  const refCode = input.refCode.trim().toUpperCase();
  assertTargetEnvironment(input.targetEnvironment);
  if (!REF_CODE.test(refCode))
    throw new Error(
      "EndpointRef 必须以字母开头，且仅包含大写字母、数字和下划线。"
    );
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    throw new Error("Endpoint 基础地址不是合法 URL。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Endpoint 仅允许无内嵌凭据的 HTTP/HTTPS 地址。");
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("Endpoint 仅允许 80 或 443 端口。");
  const secretRef = input.secretRef?.trim() || null;
  if (secretRef && !SECRET_REF.test(secretRef))
    throw new Error("SecretRef 仅允许引用 env:FLOW_SECRET_* 环境变量。");
  const authHeaderName = input.authHeaderName?.trim() || null;
  if (authHeaderName && !/^[A-Za-z0-9-]{1,128}$/.test(authHeaderName))
    throw new Error("认证请求头名称无效。");
  const authScheme = input.authScheme?.trim() || null;
  if (authScheme && !/^[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(authScheme))
    throw new Error("认证方案名称无效。");
  return {
    refCode,
    baseUrl: url.toString(),
    targetEnvironment: input.targetEnvironment,
    allowedHosts: [url.hostname.toLowerCase()],
    secretRef,
    authHeaderName,
    authScheme,
  };
}

async function requireManage(user: ProjectUser, projectId: string) {
  const access = await getProjectAccess(user, projectId);
  if (!access.exists || !access.permissions.has("project:manage"))
    throw new Error("项目不存在或当前账号无权管理服务端点。");
}

export async function listProjectServiceEndpoints(
  user: ProjectUser,
  projectId: string
) {
  const access = await getProjectAccess(user, projectId);
  if (!access.exists || !access.permissions.has("project:view"))
    throw new Error("项目不存在或当前账号无权查看服务端点。");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,projectId,refCode,name,baseUrl,targetEnvironment,allowedHostsJson,secretRef,authHeaderName,authScheme,status,createdAt,updatedAt FROM project_service_endpoint WHERE projectId=? ORDER BY status,refCode",
    [projectId]
  );
  return rows.map(row => ({
    ...row,
    refCode: String(row.refCode),
    name: String(row.name),
    baseUrl: String(row.baseUrl),
    targetEnvironment: String(row.targetEnvironment),
    status: String(row.status),
    allowedHosts:
      typeof row.allowedHostsJson === "string"
        ? JSON.parse(row.allowedHostsJson)
        : row.allowedHostsJson,
    allowedHostsJson: undefined,
    hasSecretRef: Boolean(row.secretRef),
    secretRef: row.secretRef ? String(row.secretRef) : null,
  }));
}

export async function createProjectServiceEndpoint(
  user: ProjectUser,
  input: {
    projectId: string;
    refCode: string;
    name: string;
    baseUrl: string;
    targetEnvironment: ServiceEndpointTargetEnvironment;
    secretRef?: string | null;
    authHeaderName?: string | null;
    authScheme?: string | null;
  }
) {
  await requireManage(user, input.projectId);
  const normalized = normalizeServiceEndpointDefinition(input);
  const id = randomUUID();
  await db().query(
    "INSERT INTO project_service_endpoint (id,projectId,refCode,name,baseUrl,targetEnvironment,allowedHostsJson,secretRef,authHeaderName,authScheme,status,createdByUserId) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)",
    [
      id,
      input.projectId,
      normalized.refCode,
      input.name.trim(),
      normalized.baseUrl,
      normalized.targetEnvironment,
      JSON.stringify(normalized.allowedHosts),
      normalized.secretRef,
      normalized.authHeaderName,
      normalized.authScheme,
      user.id,
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "project_service_endpoint",
    resourceId: id,
    details: {
      operation: "endpoint_created",
      projectId: input.projectId,
      refCode: normalized.refCode,
      allowedHosts: normalized.allowedHosts,
      targetEnvironment: normalized.targetEnvironment,
      hasSecretRef: Boolean(normalized.secretRef),
    },
  });
  return id;
}

export async function setProjectServiceEndpointEnvironment(
  user: ProjectUser,
  input: {
    projectId: string;
    id: string;
    targetEnvironment: ServiceEndpointTargetEnvironment;
  }
) {
  await requireManage(user, input.projectId);
  assertTargetEnvironment(input.targetEnvironment);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT targetEnvironment FROM project_service_endpoint WHERE id=? AND projectId=? LIMIT 1",
    [input.id, input.projectId]
  );
  if (!rows[0]) throw new Error("服务端点不存在。");
  const previousEnvironment = String(rows[0].targetEnvironment);
  if (previousEnvironment === input.targetEnvironment) return true;
  await db().query(
    "UPDATE project_service_endpoint SET targetEnvironment=?,updatedAt=NOW() WHERE id=? AND projectId=?",
    [input.targetEnvironment, input.id, input.projectId]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "project_service_endpoint",
    resourceId: input.id,
    details: {
      operation: "endpoint_environment_classified",
      projectId: input.projectId,
      previousEnvironment,
      targetEnvironment: input.targetEnvironment,
    },
  });
  return true;
}

export async function setProjectServiceEndpointStatus(
  user: ProjectUser,
  input: { projectId: string; id: string; status: "active" | "disabled" }
) {
  await requireManage(user, input.projectId);
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE project_service_endpoint SET status=?,updatedAt=NOW() WHERE id=? AND projectId=?",
    [input.status, input.id, input.projectId]
  );
  if (!result.affectedRows) throw new Error("服务端点不存在。");
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "project_service_endpoint",
    resourceId: input.id,
    details: {
      operation: "endpoint_status_changed",
      projectId: input.projectId,
      status: input.status,
    },
  });
  return true;
}

export async function resolveProjectServiceEndpoint(
  projectId: string,
  refCode: string
) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT refCode,baseUrl,targetEnvironment,allowedHostsJson,secretRef,authHeaderName,authScheme FROM project_service_endpoint WHERE projectId=? AND refCode=? AND status='active' LIMIT 1",
    [projectId, refCode.trim().toUpperCase()]
  );
  const row = rows[0];
  if (!row) throw new Error("项目 EndpointRef 不存在或已停用。");
  return {
    refCode: String(row.refCode),
    baseUrl: String(row.baseUrl),
    targetEnvironment: String(row.targetEnvironment),
    allowedHosts: (typeof row.allowedHostsJson === "string"
      ? JSON.parse(row.allowedHostsJson)
      : row.allowedHostsJson) as string[],
    secretRef: row.secretRef ? String(row.secretRef) : null,
    authHeaderName: row.authHeaderName ? String(row.authHeaderName) : null,
    authScheme: row.authScheme ? String(row.authScheme) : null,
  };
}

export function resolveExternalSecret(secretRef: string) {
  if (!SECRET_REF.test(secretRef))
    throw new Error("SecretRef 不在允许的外部密钥命名空间内。");
  const envName = secretRef.slice("env:".length);
  const value = process.env[envName];
  if (value) return value;

  const secretDirectory = process.env.FLOW_SECRET_FILE_DIR;
  if (!secretDirectory) throw new Error(`SecretRef ${secretRef} 未配置。`);

  const secretPath = join(secretDirectory, envName);
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(secretPath);
  } catch {
    throw new Error(`SecretRef ${secretRef} 未配置或无法读取。`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile())
    throw new Error(`SecretRef ${secretRef} 必须指向普通密钥文件。`);

  let fileValue: string;
  try {
    fileValue = readFileSync(secretPath, "utf8");
  } catch {
    throw new Error(`SecretRef ${secretRef} 未配置或无法读取。`);
  }
  if (fileValue.endsWith("\r\n")) fileValue = fileValue.slice(0, -2);
  else if (fileValue.endsWith("\n")) fileValue = fileValue.slice(0, -1);
  if (!fileValue.trim()) throw new Error(`SecretRef ${secretRef} 未配置。`);
  return fileValue;
}
