import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { recordAuthorizationAudit } from "./iam-service";
import { getProjectAccess, type ProjectUser } from "./project-service";

let pool: mysql.Pool | undefined;
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
};

const REF_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SECRET_REF = /^env:FLOW_SECRET_[A-Z0-9_]{2,128}$/;

export function normalizeServiceEndpointDefinition(input: {
  refCode: string;
  baseUrl: string;
  secretRef?: string | null;
  authHeaderName?: string | null;
  authScheme?: string | null;
}) {
  const refCode = input.refCode.trim().toUpperCase();
  if (!REF_CODE.test(refCode))
    throw new Error("EndpointRef 必须以字母开头，且仅包含大写字母、数字和下划线。");
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    throw new Error("Endpoint 基础地址不是合法 URL。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
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

export async function listProjectServiceEndpoints(user: ProjectUser, projectId: string) {
  const access = await getProjectAccess(user, projectId);
  if (!access.exists || !access.permissions.has("project:view"))
    throw new Error("项目不存在或当前账号无权查看服务端点。");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,projectId,refCode,name,baseUrl,allowedHostsJson,secretRef,authHeaderName,authScheme,status,createdAt,updatedAt FROM project_service_endpoint WHERE projectId=? ORDER BY status,refCode",
    [projectId]
  );
  return rows.map(row => ({
    ...row,
    allowedHosts: typeof row.allowedHostsJson === "string" ? JSON.parse(row.allowedHostsJson) : row.allowedHostsJson,
    allowedHostsJson: undefined,
    hasSecretRef: Boolean(row.secretRef),
    secretRef: row.secretRef ? String(row.secretRef) : null,
  }));
}

export async function createProjectServiceEndpoint(user: ProjectUser, input: {
  projectId: string;
  refCode: string;
  name: string;
  baseUrl: string;
  secretRef?: string | null;
  authHeaderName?: string | null;
  authScheme?: string | null;
}) {
  await requireManage(user, input.projectId);
  const normalized = normalizeServiceEndpointDefinition(input);
  const id = randomUUID();
  await db().query(
    "INSERT INTO project_service_endpoint (id,projectId,refCode,name,baseUrl,allowedHostsJson,secretRef,authHeaderName,authScheme,status,createdByUserId) VALUES (?,?,?,?,?,?,?,?,?,'active',?)",
    [id, input.projectId, normalized.refCode, input.name.trim(), normalized.baseUrl, JSON.stringify(normalized.allowedHosts), normalized.secretRef, normalized.authHeaderName, normalized.authScheme, user.id]
  );
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "project_service_endpoint", resourceId: id, details: { operation: "endpoint_created", projectId: input.projectId, refCode: normalized.refCode, allowedHosts: normalized.allowedHosts, hasSecretRef: Boolean(normalized.secretRef) } });
  return id;
}

export async function setProjectServiceEndpointStatus(user: ProjectUser, input: { projectId: string; id: string; status: "active" | "disabled" }) {
  await requireManage(user, input.projectId);
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE project_service_endpoint SET status=?,updatedAt=NOW() WHERE id=? AND projectId=?",
    [input.status, input.id, input.projectId]
  );
  if (!result.affectedRows) throw new Error("服务端点不存在。");
  await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "project_service_endpoint", resourceId: input.id, details: { operation: "endpoint_status_changed", projectId: input.projectId, status: input.status } });
  return true;
}

export async function resolveProjectServiceEndpoint(projectId: string, refCode: string) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT refCode,baseUrl,allowedHostsJson,secretRef,authHeaderName,authScheme FROM project_service_endpoint WHERE projectId=? AND refCode=? AND status='active' LIMIT 1",
    [projectId, refCode.trim().toUpperCase()]
  );
  const row = rows[0];
  if (!row) throw new Error("项目 EndpointRef 不存在或已停用。");
  return {
    refCode: String(row.refCode),
    baseUrl: String(row.baseUrl),
    allowedHosts: (typeof row.allowedHostsJson === "string" ? JSON.parse(row.allowedHostsJson) : row.allowedHostsJson) as string[],
    secretRef: row.secretRef ? String(row.secretRef) : null,
    authHeaderName: row.authHeaderName ? String(row.authHeaderName) : null,
    authScheme: row.authScheme ? String(row.authScheme) : null,
  };
}

export function resolveExternalSecret(secretRef: string) {
  if (!SECRET_REF.test(secretRef)) throw new Error("SecretRef 不在允许的外部密钥命名空间内。");
  const envName = secretRef.slice("env:".length);
  const value = process.env[envName];
  if (!value) throw new Error(`SecretRef ${secretRef} 未配置。`);
  return value;
}
