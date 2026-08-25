import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import mysql from "mysql2/promise";
import {
  approvalRequirement,
  normalizeReferenceOperateConfig,
  type TemporaryRoleChange,
} from "../shared/reference-operate-config";
import {
  normalizeReferenceRouterConfig,
  type NormalizedRouterRule,
} from "../shared/reference-router-config";
import { invokeLLM, listLLMModels, type ModelInfo } from "./_core/llm";
import { currentRequestId } from "./_core/http-security";
import {
  assertWorkflowExecutionPlan,
  compileWorkflowDefinition,
  hashWorkflowExecutionPlan,
  type WorkflowExecutionPlan,
} from "./workflow-compiler";
import {
  resolveAutoRelatedParticipantUserIds,
  resolveOperateAssignees,
  resolveWorkflowUserRoleKeys,
} from "./organization-service";
import type { Definition } from "./workflow-service";

type JsonRecord = Record<string, unknown>;
type WorkflowUser = { id: number; role: "user" | "admin" };
export type ApprovalDecision = "approved" | "rejected" | "abstained";
type WorkflowNode = Definition["nodes"][number];
type WorkflowEdge = Definition["edges"][number];

export function resolveRuntimeLlmModel(
  requestedModel: string | undefined,
  catalog: Pick<ModelInfo, "id">[]
): string | undefined {
  if (requestedModel) {
    if (!catalog.some(item => item.id === requestedModel)) {
      throw new Error(
        `LLM 节点指定模型不在运行时白名单中：${requestedModel}。`
      );
    }
    return requestedModel;
  }
  return catalog[0]?.id;
}

export function parseStructuredLlmOutput(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("LLM 节点结构化输出不是合法 JSON。");
  }
}

export function assertJsonSchemaValue(
  value: unknown,
  schema: Record<string, unknown>,
  path = "$"
): void {
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))
  )
    throw new Error(`LLM 结构化输出 ${path} 不在允许的枚举值中。`);
  const type = typeof schema.type === "string" ? schema.type : undefined;
  const matchesType =
    !type ||
    (type === "object" &&
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value)) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "string" && typeof value === "string") ||
    (type === "number" &&
      typeof value === "number" &&
      Number.isFinite(value)) ||
    (type === "integer" && Number.isInteger(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "null" && value === null);
  if (!matchesType)
    throw new Error(`LLM 结构化输出 ${path} 类型不符合 ${type} 约束。`);
  if (
    type === "object" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const record = value as JsonRecord;
    const required = Array.isArray(schema.required)
      ? schema.required.map(String)
      : [];
    for (const key of required)
      if (!(key in record) || record[key] === undefined || record[key] === null)
        throw new Error(`LLM 结构化输出缺少必填字段：${path}.${key}。`);
    const properties = asRecord(schema.properties);
    for (const [key, childSchema] of Object.entries(properties)) {
      if (
        record[key] !== undefined &&
        childSchema &&
        typeof childSchema === "object" &&
        !Array.isArray(childSchema)
      )
        assertJsonSchemaValue(
          record[key],
          childSchema as Record<string, unknown>,
          `${path}.${key}`
        );
    }
    if (schema.additionalProperties === false) {
      const unexpected = Object.keys(record).find(key => !(key in properties));
      if (unexpected)
        throw new Error(
          `LLM 结构化输出包含未允许字段：${path}.${unexpected}。`
        );
    }
  }
  if (
    type === "array" &&
    Array.isArray(value) &&
    schema.items &&
    typeof schema.items === "object" &&
    !Array.isArray(schema.items)
  )
    value.forEach((item, index) =>
      assertJsonSchemaValue(
        item,
        schema.items as Record<string, unknown>,
        `${path}[${index}]`
      )
    );
}

export function validateFormSubmission(
  fields: unknown[],
  submittedValue: unknown
) {
  const submitted = asRecord(submittedValue);
  const result: JsonRecord = {};
  for (const rawField of fields) {
    const field = asRecord(rawField);
    const key = String(field.key ?? "").trim();
    if (!key) throw new Error("表单字段缺少 key。");
    const hasSubmitted = Object.prototype.hasOwnProperty.call(submitted, key);
    let value = hasSubmitted ? submitted[key] : field.defaultValue;
    if (
      field.readOnly === true &&
      hasSubmitted &&
      JSON.stringify(value) !== JSON.stringify(field.defaultValue)
    )
      throw new Error(`表单字段“${key}”为只读，不允许由调用方修改。`);
    const empty = value === undefined || value === null || value === "";
    if (field.required === true && empty)
      throw new Error(`表单必填字段“${key}”缺失。`);
    if (empty) continue;
    const type = String(field.type ?? "text").toLowerCase();
    if (
      ["text", "string", "textarea", "email", "date", "select"].includes(
        type
      ) &&
      typeof value !== "string"
    )
      throw new Error(`表单字段“${key}”必须是字符串。`);
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))
      throw new Error(`表单字段“${key}”不是有效邮箱。`);
    if (type === "date" && Number.isNaN(Date.parse(String(value))))
      throw new Error(`表单字段“${key}”不是有效日期。`);
    if (
      type === "number" &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      throw new Error(`表单字段“${key}”必须是有限数值。`);
    if (type === "boolean" && typeof value !== "boolean")
      throw new Error(`表单字段“${key}”必须是布尔值。`);
    if (type === "multiselect" && !Array.isArray(value))
      throw new Error(`表单字段“${key}”必须是数组。`);
    const options = Array.isArray(field.options)
      ? field.options.map(option => {
          const record = asRecord(option);
          return Object.keys(record).length ? record.value : option;
        })
      : [];
    if (options.length) {
      const values = type === "multiselect" ? (value as unknown[]) : [value];
      if (
        values.some(
          item =>
            !options.some(
              option => JSON.stringify(option) === JSON.stringify(item)
            )
        )
      )
        throw new Error(`表单字段“${key}”包含选项范围外的值。`);
    }
    if (
      typeof value === "string" &&
      Number.isFinite(Number(field.maxLength)) &&
      value.length > Number(field.maxLength)
    )
      throw new Error(`表单字段“${key}”超过最大长度。`);
    if (
      typeof value === "number" &&
      Number.isFinite(Number(field.min)) &&
      value < Number(field.min)
    )
      throw new Error(`表单字段“${key}”低于最小值。`);
    if (
      typeof value === "number" &&
      Number.isFinite(Number(field.max)) &&
      value > Number(field.max)
    )
      throw new Error(`表单字段“${key}”超过最大值。`);
    result[key] = value;
  }
  return result;
}

export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, item]) => [
      key,
      /(password|passwd|secret|token|api[_-]?key|authorization|cookie)/i.test(
        key
      )
        ? "[REDACTED]"
        : redactSensitiveValues(item),
    ])
  );
}
export type WorkflowRunDetail = {
  workflowId: string;
  nodeRuns: mysql.RowDataPacket[];
  [key: string]: unknown;
};
export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "blocked",
  "success",
  "failed",
  "cancelled",
  "terminated",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
const workflowRunTransitions: Record<
  WorkflowRunStatus,
  readonly WorkflowRunStatus[]
> = {
  queued: ["running", "blocked", "cancelled", "terminated"],
  running: [
    "waiting",
    "success",
    "failed",
    "blocked",
    "cancelled",
    "terminated",
  ],
  waiting: ["queued", "blocked", "cancelled", "terminated"],
  blocked: ["queued", "cancelled", "terminated"],
  success: [],
  failed: [],
  cancelled: [],
  terminated: [],
};
export function canTransitionWorkflowRunStatus(
  from: WorkflowRunStatus,
  to: WorkflowRunStatus
) {
  return from === to || workflowRunTransitions[from].includes(to);
}
export function assertWorkflowRunTransition(
  from: WorkflowRunStatus,
  to: WorkflowRunStatus
) {
  if (!canTransitionWorkflowRunStatus(from, to))
    throw new Error(`运行状态不允许从 ${from} 迁移到 ${to}。`);
  return to;
}
export type RunFilters = {
  status?: WorkflowRunStatus;
  from?: Date;
  to?: Date;
  triggeredByUserId?: number;
  limit?: number;
};

const MAX_STEPS = 100;
const MAX_HTTP_RESPONSE_BYTES = 1_000_000;
const HTTP_TIMEOUT_MS = 15_000;
const WORKFLOW_JOB_MAX_ATTEMPTS = 3;

export type WorkflowCheckpoint = {
  queue: string[];
  context: JsonRecord;
  finalOutput?: unknown;
  currentNodeId?: string | null;
};

export type WorkflowExecutionResult =
  | { runId: string; status: "success"; output: unknown }
  | { runId: string; status: "waiting"; taskId: string };

let pool: mysql.Pool | undefined;
function db() {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getPath(context: unknown, path: string): unknown {
  const segments = path
    .trim()
    .replace(/^\$\.?/, "")
    .split(".")
    .filter(Boolean);
  let value: unknown = context;
  for (const segment of segments) {
    if (Array.isArray(value) && /^\d+$/.test(segment))
      value = value[Number(segment)];
    else if (value && typeof value === "object")
      value = (value as JsonRecord)[segment];
    else return undefined;
  }
  return value;
}

/** Resolves {{input.topic}} and {{nodes.http-1.body.title}} without executing arbitrary expressions. */
export function interpolate(value: unknown, context: JsonRecord): unknown {
  if (typeof value !== "string") return value;
  const exact = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (exact) return getPath(context, exact[1]);
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => {
    const resolved = getPath(context, path);
    return resolved === undefined || resolved === null
      ? ""
      : typeof resolved === "string"
        ? resolved
        : JSON.stringify(resolved);
  });
}

function resolveTemplates(value: unknown, context: JsonRecord): unknown {
  if (Array.isArray(value))
    return value.map(item => resolveTemplates(item, context));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, item]) => [
        key,
        resolveTemplates(item, context),
      ])
    );
  return interpolate(value, context);
}

function blockedIp(address: string) {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) return blockedIp(mapped);
    const hexadecimal = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexadecimal) {
      const high = Number.parseInt(hexadecimal[1], 16);
      const low = Number.parseInt(hexadecimal[2], 16);
      return blockedIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  );
}

async function resolveSafeHttpTarget(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("HTTP 节点 URL 无效。");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("HTTP 节点仅支持 http 或 https 协议。");
  if (url.username || url.password)
    throw new Error("HTTP 节点 URL 不允许包含凭据。");
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("HTTP 节点仅允许 80 或 443 端口。");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    throw new Error("HTTP 节点拒绝本机地址。");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => blockedIp(item.address)))
    throw new Error("HTTP 节点拒绝私有、环回、链路本地或保留网络地址。");
  const selected = addresses[0]!;
  return {
    url,
    address: selected.address,
    family: isIP(selected.address),
  };
}

export async function assertSafeHttpUrl(rawUrl: string) {
  return (await resolveSafeHttpTarget(rawUrl)).url;
}

function requestPinnedHttp(input: {
  url: URL;
  address: string;
  family: number;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}) {
  return new Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bytes: Uint8Array;
  }>((resolve, reject) => {
    const transport = input.url.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname,
        port: input.url.port || (input.url.protocol === "https:" ? 443 : 80),
        path: `${input.url.pathname}${input.url.search}`,
        method: input.method,
        headers: input.headers,
        servername: input.url.hostname,
        lookup: ((
          _hostname: string,
          _options: unknown,
          callback: (
            error: Error | null,
            address: string,
            family: number
          ) => void
        ) => callback(null, input.address, input.family)) as any,
      },
      response => {
        const status = Number(response.statusCode ?? 0);
        const contentLength = Number(response.headers["content-length"] ?? "0");
        if (
          Number.isFinite(contentLength) &&
          contentLength > MAX_HTTP_RESPONSE_BYTES
        ) {
          response.destroy();
          reject(new Error("HTTP 节点响应超过 1MB 限制。"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", chunk => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > MAX_HTTP_RESPONSE_BYTES) {
            response.destroy(new Error("HTTP 节点响应超过 1MB 限制。"));
            return;
          }
          chunks.push(buffer);
        });
        response.once("error", reject);
        response.once("end", () => {
          if (status >= 300 && status < 400) {
            reject(new Error("HTTP 节点禁止跟随重定向。"));
            return;
          }
          resolve({
            status,
            statusText: String(response.statusMessage ?? ""),
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(", ") : String(value ?? ""),
              ])
            ),
            bytes: new Uint8Array(Buffer.concat(chunks)),
          });
        });
      }
    );
    request.setTimeout(input.timeoutMs, () =>
      request.destroy(new Error("HTTP 节点请求超时。"))
    );
    request.once("error", reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

/**
 * Adds a stable per-run/per-node key to mutating outbound calls. Remote services
 * can use this header to collapse retries after a Worker lease loss or crash.
 */
export function withWorkflowIdempotencyHeader(
  method: string,
  headers: JsonRecord,
  context: JsonRecord
) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  );
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method))
    return normalizedHeaders;
  if (
    Object.keys(normalizedHeaders).some(
      key => key.toLowerCase() === "idempotency-key"
    )
  )
    return normalizedHeaders;
  const runtime = asRecord(context.runtime);
  const runId =
    typeof runtime.executionRunId === "string"
      ? runtime.executionRunId.trim()
      : "";
  const nodeId =
    typeof runtime.executionNodeId === "string"
      ? runtime.executionNodeId.trim()
      : "";
  if (runId && nodeId)
    normalizedHeaders["Idempotency-Key"] = `flow:${runId}:${nodeId}`;
  return normalizedHeaders;
}

async function executeHttpNode(config: JsonRecord, context: JsonRecord) {
  const resolved = asRecord(resolveTemplates(config, context));
  const target = await resolveSafeHttpTarget(String(resolved.url ?? ""));
  const url = target.url;
  const query = asRecord(resolved.query);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null)
      url.searchParams.set(key, String(value));
  }
  const method = String(resolved.method ?? "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
    throw new Error("HTTP 节点请求方法不受支持。");
  const headers = asRecord(resolved.headers);
  const safeHeaders = withWorkflowIdempotencyHeader(
    method,
    Object.fromEntries(
      Object.entries(headers).filter(
        ([key]) =>
          !["host", "connection", "content-length"].includes(key.toLowerCase())
      )
    ),
    context
  );
  const body = resolved.body;
  const serializedBody =
    body === undefined || body === null
      ? undefined
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  if (
    serializedBody &&
    !Object.keys(safeHeaders).some(key => key.toLowerCase() === "content-type")
  )
    safeHeaders["content-type"] = "application/json";
  const configuredTimeout =
    typeof resolved.timeout === "number" && Number.isFinite(resolved.timeout)
      ? resolved.timeout
      : HTTP_TIMEOUT_MS;
  const timeoutMs = Math.min(
    Math.max(Math.floor(configuredTimeout), 1_000),
    HTTP_TIMEOUT_MS
  );
  const response = await requestPinnedHttp({
    url,
    address: target.address,
    family: target.family,
    method,
    headers: safeHeaders,
    body: ["GET", "DELETE"].includes(method) ? undefined : serializedBody,
    timeoutMs,
  });
  const bytes = response.bytes;
  const text = new TextDecoder().decode(bytes);
  const contentType = response.headers["content-type"] ?? "";
  let parsedBody: unknown = text;
  if (contentType.includes("application/json")) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      /* preserve malformed body as text */
    }
  }
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      `HTTP 节点请求失败：${response.status} ${response.statusText}`
    );
  return {
    status: response.status,
    headers: redactSensitiveValues(response.headers),
    body: parsedBody,
  };
}

function firstConfiguredString(...values: unknown[]) {
  return values.find(value => typeof value === "string" && value.trim()) as
    | string
    | undefined;
}

function keyValueEntries(value: unknown) {
  if (!Array.isArray(value)) return asRecord(value);
  return Object.fromEntries(
    value
      .map(item => asRecord(item))
      .filter(item => typeof item.key === "string" && item.key.trim())
      .map(item => [String(item.key), item.value])
  );
}

function parseReferenceBody(value: unknown) {
  if (typeof value !== "string") return value;
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Converts the original REST/METHOD persistence shape without dropping legacy keys or weakening HTTP guards. */
export function normalizeReferenceHttpConfig(config: JsonRecord): JsonRecord {
  const method = String(
    firstConfiguredString(config.restType, config.method) ?? "GET"
  ).toUpperCase();
  const attributes = asRecord(config.restAttributeMap);
  const query = {
    ...keyValueEntries(config.restGetBodyParam),
    ...asRecord(attributes.restEntryParam),
  };
  return {
    url:
      firstConfiguredString(config.restApi, config.endpoint, config.url) ?? "",
    method,
    headers: keyValueEntries(config.restHeaderParam ?? config.headers),
    body: parseReferenceBody(
      config.restJsonParam === undefined || config.restJsonParam === ""
        ? config.body
        : config.restJsonParam
    ),
    query,
    timeout: config.timeout,
  };
}

async function executeLlmNode(config: JsonRecord, context: JsonRecord) {
  const resolved = asRecord(resolveTemplates(config, context));
  const catalog = await listLLMModels();
  const requestedModel =
    typeof resolved.model === "string" ? resolved.model : undefined;
  const model = resolveRuntimeLlmModel(requestedModel, catalog.data);
  const systemPrompt = String(
    resolved.systemPrompt ?? "你是一名严谨的工作流助手。"
  );
  const prompt = String(resolved.prompt ?? resolved.userPrompt ?? "");
  if (!prompt.trim()) throw new Error("LLM 节点必须配置提示词。");
  const maxTokens =
    typeof resolved.maxTokens === "number"
      ? Math.min(Math.max(Math.floor(resolved.maxTokens), 64), 8192)
      : undefined;
  const timeoutMs =
    typeof resolved.timeoutMs === "number"
      ? Math.min(Math.max(Math.floor(resolved.timeoutMs), 1_000), 120_000)
      : 30_000;
  const outputSchema =
    resolved.outputSchema &&
    typeof resolved.outputSchema === "object" &&
    !Array.isArray(resolved.outputSchema)
      ? asRecord(resolved.outputSchema)
      : undefined;
  if (
    outputSchema &&
    (typeof outputSchema.name !== "string" ||
      !outputSchema.name.trim() ||
      !outputSchema.schema ||
      typeof outputSchema.schema !== "object")
  )
    throw new Error("LLM 节点结构化输出 Schema 必须包含 name 和 schema 对象。");
  const startedAt = Date.now();
  const response = await invokeLLM({
    model,
    maxTokens,
    timeoutMs,
    ...(outputSchema
      ? {
          outputSchema: {
            name: String(outputSchema.name),
            schema: outputSchema.schema as Record<string, unknown>,
            strict: outputSchema.strict === true,
          },
        }
      : {}),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });
  const content = response.choices[0]?.message.content;
  const contentText = Array.isArray(content)
    ? content
        .map(part => ("text" in part ? part.text : JSON.stringify(part)))
        .join("\n")
    : (content ?? "");
  let structured: unknown;
  if (outputSchema) {
    structured = parseStructuredLlmOutput(contentText);
    assertJsonSchemaValue(
      structured,
      outputSchema.schema as Record<string, unknown>
    );
  }
  return {
    model: response.model || model,
    content: contentText,
    ...(structured === undefined ? {} : { structured }),
    usage: response.usage ?? null,
    finishReason: response.choices[0]?.finish_reason ?? null,
    durationMs: Date.now() - startedAt,
    requestId:
      String(asRecord(context.runtime).requestId ?? currentRequestId() ?? "") ||
      null,
  };
}

function compareCondition(left: unknown, operator: string, right: unknown) {
  switch (operator) {
    case "equals":
      return left === right;
    case "notEquals":
      return left !== right;
    case "contains":
      return typeof left === "string"
        ? left.includes(String(right ?? ""))
        : Array.isArray(left)
          ? left.includes(right)
          : false;
    case "exists":
      return left !== undefined && left !== null && left !== "";
    case "greaterThan":
      return Number(left) > Number(right);
    case "lessThan":
      return Number(left) < Number(right);
    default:
      throw new Error(`条件节点不支持操作符：${operator}`);
  }
}

function routerRuleMatches(
  rule: NormalizedRouterRule,
  context: JsonRecord,
  roleKeys: string[]
) {
  if (rule.hasUnsafeCode)
    throw new Error("路由规则包含原版任意代码，必须迁移为安全条件后才能运行。");
  const hasRoleFilter = rule.roleKeys.length > 0;
  const roleMatched =
    !hasRoleFilter || rule.roleKeys.some(role => roleKeys.includes(role));
  const hasConditions = rule.conditions.length > 0;
  const conditionsMatched =
    !hasConditions ||
    rule.conditions.every(condition =>
      compareCondition(
        interpolate(condition.left, context),
        condition.operator,
        interpolate(condition.right, context)
      )
    );
  if (rule.relation === "or" && (hasRoleFilter || hasConditions)) {
    return (
      (hasRoleFilter && roleMatched) || (hasConditions && conditionsMatched)
    );
  }
  return roleMatched && conditionsMatched;
}

/**
 * 按原版语义为每个当前人员分别匹配路由。非广播模式每人只进入首个命中分支，
 * 广播模式允许同一人员进入多个分支；权重越大越优先，-1 为默认规则。
 */
export function selectRouterRoutes(
  config: JsonRecord,
  context: JsonRecord,
  participantUserIds: number[] = [],
  roleKeysByUser: Map<number, string[]> = new Map()
) {
  const resolved = asRecord(resolveTemplates(config, context));
  const normalized = normalizeReferenceRouterConfig(resolved);
  const participants = Array.from(
    new Set(participantUserIds.filter(id => Number.isInteger(id) && id > 0))
  );
  const assignments = new Map<
    string,
    { handle: string; targetNodeId: string; userIds: number[] }
  >();
  const addAssignment = (
    rule: Pick<NormalizedRouterRule, "handle" | "targetNodeId">,
    userId: number
  ) => {
    const key = `${rule.handle}\u0000${rule.targetNodeId}`;
    const current = assignments.get(key) ?? {
      handle: rule.handle,
      targetNodeId: rule.targetNodeId,
      userIds: [],
    };
    if (!current.userIds.includes(userId)) current.userIds.push(userId);
    assignments.set(key, current);
  };

  if (participants.length) {
    const ordinaryRules = normalized.rules.filter(rule => !rule.isDefault);
    const defaultRule = normalized.rules.find(rule => rule.isDefault);
    for (const userId of participants) {
      const roles = Array.from(
        new Set(["default", ...(roleKeysByUser.get(userId) ?? [])])
      );
      let matched = false;
      for (const rule of ordinaryRules) {
        if (!routerRuleMatches(rule, context, roles)) continue;
        matched = true;
        addAssignment(rule, userId);
        if (!normalized.broadcast) break;
      }
      if (!matched) {
        const fallback = defaultRule ?? {
          handle: String(interpolate(normalized.defaultRoute, context)),
          targetNodeId: "",
        };
        addAssignment(fallback, userId);
      }
    }
  } else {
    // 保持无人员数据流和既有控制流定义的兼容行为。
    const matched = normalized.rules.find(
      rule => !rule.isDefault && routerRuleMatches(rule, context, ["default"])
    );
    const fallback = normalized.rules.find(rule => rule.isDefault) ?? {
      handle: String(interpolate(normalized.defaultRoute, context)),
      targetNodeId: "",
    };
    const selected = matched ?? fallback;
    assignments.set(`${selected.handle}\u0000${selected.targetNodeId}`, {
      handle: selected.handle,
      targetNodeId: selected.targetNodeId,
      userIds: [],
    });
  }

  const selectedBranches = Array.from(assignments.values());
  return {
    broadcast: normalized.broadcast,
    rules: normalized.rules,
    selectedBranches,
    selectedRoutes: Array.from(
      new Set(selectedBranches.map(branch => branch.handle))
    ),
    selectedRoute: selectedBranches[0]?.handle ?? normalized.defaultRoute,
  };
}

/** 兼容旧调用方的单一路由返回结构。 */
export function selectRouterRoute(config: JsonRecord, context: JsonRecord) {
  return selectRouterRoutes(config, context);
}

async function executeInlineDefinition(
  definition: Definition,
  input: JsonRecord
) {
  const context: JsonRecord = { input, vars: {}, nodes: {} };
  const nodes = new Map(definition.nodes.map(node => [node.id, node]));
  const startNode = definition.nodes.find(node => node.type === "start");
  if (!startNode) throw new Error("子流程缺少开始节点。");
  const queue = [startNode.id];
  const executed = new Set<string>();
  let finalOutput: unknown = null;
  while (queue.length) {
    if (executed.size >= MAX_STEPS)
      throw new Error("子流程执行超过最大节点步数。");
    const nodeId = queue.shift()!;
    if (executed.has(nodeId)) continue;
    const node = nodes.get(nodeId);
    if (!node) throw new Error(`子流程引用了不存在的节点：${nodeId}`);
    if (node.type === "subflow") throw new Error("子流程不允许嵌套调用。");
    executed.add(nodeId);
    const result = await executeNode(node, context, false);
    const vars = asRecord(context.vars);
    const nodeOutputs = asRecord(context.nodes);
    vars[node.id] = result.output;
    nodeOutputs[node.id] = result.output;
    context.vars = vars;
    context.nodes = nodeOutputs;
    if (node.type === "start") Object.assign(vars, asRecord(result.output));
    if (node.type === "end") finalOutput = result.output;
    definition.edges
      .filter(
        edge =>
          edge.sourceNodeId === node.id &&
          (!result.route || (edge.sourceHandle ?? "default") === result.route)
      )
      .forEach(edge => queue.push(edge.targetNodeId));
  }
  return { output: finalOutput, context };
}

async function executeSubflowNode(
  config: JsonRecord,
  context: JsonRecord,
  ownerUserId: number
) {
  const snapshot = config.resolvedSubflowDefinition;
  const { resolvedSubflowDefinition: _snapshot, ...runtimeConfig } = config;
  const resolved = asRecord(resolveTemplates(runtimeConfig, context));
  const subflowId = String(resolved.subflowId ?? "").trim();
  if (!subflowId) throw new Error("子流程节点缺少子流程标识。");
  let subflowName = String(resolved.resolvedSubflowName ?? "").trim();
  let definition: Definition;
  let snapshotUpdatedAt = resolved.resolvedSubflowUpdatedAt ?? null;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    definition = snapshot as Definition;
  } else {
    // Compatibility path for execution plans published before subflow snapshots.
    const [rows] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id,name,definitionJson,isEnabled,updatedAt FROM workflow_subflow WHERE id=? AND ownerUserId=? LIMIT 1",
      [subflowId, ownerUserId]
    );
    const subflow = rows[0];
    if (!subflow || !subflow.isEnabled)
      throw new Error("引用的子流程不存在或已停用。");
    definition = readJson(subflow.definitionJson) as Definition;
    subflowName = String(subflow.name);
    snapshotUpdatedAt = subflow.updatedAt ?? null;
  }
  if (!definition?.nodes?.length) throw new Error("引用的子流程定义为空。");
  const input = asRecord(resolved.input ?? context.input);
  const result = await executeInlineDefinition(definition, input);
  return {
    subflowId,
    subflowName,
    snapshotUpdatedAt,
    result: result.output,
  };
}

async function executeNode(
  node: WorkflowNode,
  context: JsonRecord,
  allowSubflow = true,
  subflowOwnerUserId?: number
) {
  const config = asRecord(node.config);
  switch (node.type) {
    case "start":
      return {
        output: asRecord(
          resolveTemplates(asRecord(config.initialVariables), context)
        ),
      };
    case "state":
      return {
        output: {
          stateCode: String(
            resolveTemplates(
              firstConfiguredString(config.nodeDh, config.stateCode) ?? "STATE",
              context
            )
          ),
          displayName: String(
            resolveTemplates(
              firstConfiguredString(config.jdmc, config.displayName) ??
                node.name,
              context
            )
          ),
          stateType: String(
            resolveTemplates(config.stateType ?? "business", context)
          ),
          stateColor: resolveTemplates(config.stateColor, context),
          flowStatus: resolveTemplates(config.flowStatus, context),
        },
      };
    case "form": {
      const submitted = validateFormSubmission(
        Array.isArray(config.fields) ? config.fields : [],
        context.input
      );
      return {
        output: {
          fields: resolveTemplates(
            Array.isArray(config.fields) ? config.fields : [],
            context
          ),
          submitted,
        },
      };
    }
    case "router": {
      const runtime = asRecord(context.runtime);
      const participantUserIds = Array.isArray(
        runtime.currentNodeParticipantUserIds
      )
        ? runtime.currentNodeParticipantUserIds
            .map(Number)
            .filter(id => Number.isInteger(id) && id > 0)
        : [];
      const roleKeysByUser = new Map<number, string[]>();
      const configuredRoles = asRecord(runtime.roleKeysByUser);
      for (const userId of participantUserIds) {
        const keys = Array.isArray(configuredRoles[String(userId)])
          ? (configuredRoles[String(userId)] as unknown[])
          : [];
        roleKeysByUser.set(userId, keys.map(String));
      }
      const result = selectRouterRoutes(
        config,
        context,
        participantUserIds,
        roleKeysByUser
      );
      return {
        output: result,
        route: result.selectedRoute,
        routeTargets: result.selectedBranches,
      };
    }
    case "rest":
    case "method":
      return {
        output: await executeHttpNode(
          normalizeReferenceHttpConfig(config),
          context
        ),
      };
    case "operate":
      throw new Error(
        "操作节点需要 P1 人工任务工作台；当前运行已安全阻断，未执行任何外部操作。"
      );
    case "sql":
      throw new Error(
        "SQL 节点需要 P2 数据源与查询策略；当前运行已安全阻断，未执行任何数据库语句。"
      );
    case "transform":
      return {
        output: asRecord(
          resolveTemplates(asRecord(config.mappings ?? config.output), context)
        ),
      };
    case "condition": {
      const left = interpolate(config.left, context);
      const right = interpolate(config.right, context);
      const matched = compareCondition(
        left,
        String(config.operator ?? "equals"),
        right
      );
      return {
        output: { matched, left, right },
        route: matched
          ? String(config.trueHandle ?? "true")
          : String(config.falseHandle ?? "false"),
      };
    }
    case "http":
      return { output: await executeHttpNode(config, context) };
    case "llm":
      return { output: await executeLlmNode(config, context) };
    case "subflow": {
      if (!allowSubflow) throw new Error("子流程不允许嵌套调用。");
      if (!subflowOwnerUserId) throw new Error("子流程缺少流程所有者上下文。");
      return {
        output: await executeSubflowNode(config, context, subflowOwnerUserId),
      };
    }
    case "end":
      return {
        output: {
          result: resolveTemplates(
            config.resultTemplate ?? "{{vars}}",
            context
          ),
        },
      };
    default:
      throw new Error(`不支持的节点类型：${node.type}`);
  }
}

async function insertNodeRun(
  runId: string,
  node: WorkflowNode,
  input: JsonRecord,
  requestId?: string | null
) {
  const nodeRunId = randomUUID();
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [sequenceUpdate] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE workflow_run SET nextNodeSequence=LAST_INSERT_ID(nextNodeSequence+1) WHERE id=?",
      [runId]
    );
    if (sequenceUpdate.affectedRows !== 1)
      throw new Error("流程运行不存在，无法记录节点执行顺序。");
    const [sequenceRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT LAST_INSERT_ID() AS sequenceNo"
    );
    const sequenceNo = Number(sequenceRows[0]?.sequenceNo);
    if (!Number.isInteger(sequenceNo) || sequenceNo < 1)
      throw new Error("无法生成节点执行序号。");
    await connection.query(
      "INSERT INTO workflow_node_run (id,runId,sequenceNo,nodeId,nodeType,nodeName,status,inputJson,requestId,startedAt) VALUES (?,?,?,?,?,?,'running',?,?,NOW())",
      [
        nodeRunId,
        runId,
        sequenceNo,
        node.id,
        node.type,
        node.name,
        JSON.stringify(input),
        requestId ?? currentRequestId() ?? null,
      ]
    );
    await connection.commit();
    return nodeRunId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function normalizeApprovalResult(result: JsonRecord) {
  const decision = String(result.decision ?? "")
    .trim()
    .toLowerCase();
  if (
    decision !== "approved" &&
    decision !== "rejected" &&
    decision !== "abstained"
  )
    throw new Error("审批结果必须明确选择同意或拒绝；也可选择弃权。");
  const comment =
    typeof result.comment === "string" ? result.comment.trim() : "";
  if (decision === "rejected" && !comment)
    throw new Error("拒绝审批时必须填写处理意见。");
  return {
    ...result,
    decision: decision as ApprovalDecision,
    ...(comment ? { comment } : {}),
  };
}

export function evaluateApprovalResults(input: {
  totalApprovers: number;
  requiredApprovals: number;
  results: unknown[];
}) {
  const decisions = input.results.map(result =>
    String(asRecord(result).decision ?? "")
      .trim()
      .toLowerCase()
  );
  const approved = decisions.filter(decision => decision === "approved").length;
  const rejected = decisions.filter(decision => decision === "rejected").length;
  const abstained = decisions.filter(
    decision => decision === "abstained"
  ).length;
  const completed = approved + rejected + abstained;
  const pending = Math.max(0, input.totalApprovers - completed);
  const outcome =
    approved >= input.requiredApprovals
      ? "approved"
      : approved + pending < input.requiredApprovals
        ? "rejected"
        : "waiting";
  return {
    outcome: outcome as ApprovalDecision | "waiting",
    approved,
    rejected,
    abstained,
    completed,
    pending,
  };
}

async function finishNodeRun(
  nodeRunId: string,
  status: "success" | "failed" | "waiting" | "skipped",
  startedAt: number,
  output?: unknown,
  error?: unknown
) {
  await db().query(
    "UPDATE workflow_node_run SET status=?,outputJson=?,errorJson=?,finishedAt=NOW(),durationMs=? WHERE id=?",
    [
      status,
      output === undefined ? null : JSON.stringify(output),
      error === undefined ? null : JSON.stringify(error),
      Date.now() - startedAt,
      nodeRunId,
    ]
  );
}

async function createFailureAlerts(
  input: {
    workflowId: string;
    workflowName: string;
    runId: string;
    ownerUserId: number;
    triggeredByUserId: number;
    details: JsonRecord;
  },
  executor: mysql.Pool | mysql.PoolConnection = db()
) {
  const recipients = Array.from(
    new Set([input.ownerUserId, input.triggeredByUserId])
  );
  if (recipients.length) {
    await executor.query(
      "INSERT INTO workflow_run_alert (id,workflowId,runId,recipientUserId,severity,summary,detailsJson) VALUES ?",
      [
        recipients.map(recipientUserId => [
          randomUUID(),
          input.workflowId,
          input.runId,
          recipientUserId,
          "critical",
          `流程“${input.workflowName}”运行失败`,
          JSON.stringify(input.details),
        ]),
      ]
    );
  }
  const notificationPayload = {
    title: "Flow AI Engine 运行失败",
    content: `流程：${input.workflowName}\n运行：${input.runId}\n原因：${String(input.details.message ?? "未知错误")}`,
  };
  await executor.query(
    `INSERT INTO workflow_outbox_event
      (id,eventType,aggregateType,aggregateId,dedupeKey,payloadJson,status,maxAttempts)
      VALUES (?,?,?,?,?,?, 'queued', 8)
      ON DUPLICATE KEY UPDATE id=id`,
    [
      randomUUID(),
      "workflow.run.failed.notification",
      "workflow_run",
      input.runId,
      `workflow-run-failed-notification:${input.runId}`,
      JSON.stringify({
        ...notificationPayload,
        workflowId: input.workflowId,
        runId: input.runId,
      }),
    ]
  );
}

export async function submitWorkflowRun(input: {
  workflowId: string;
  triggeredBy: WorkflowUser;
  workflowInput?: JsonRecord;
  idempotencyKey?: string;
  requestId?: string;
}) {
  const [workflowRows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,ownerUserId,name,projectId,flowType,status,auditStatus,archivedAt,definitionJson,publishedExecutionPlanJson,publishedExecutionPlanHash FROM workflow WHERE id=? LIMIT 1",
    [input.workflowId]
  );
  const workflow = workflowRows[0] as PersistedWorkflow | undefined;
  if (!workflow) throw new Error("流程不存在。");
  if (workflow.flowType === "data")
    throw new Error("数据流程必须通过数据流运行入口启动。");
  if (workflow.archivedAt)
    throw new Error("已归档流程不能发起运行，请先恢复流程。");
  if (
    workflow.projectId &&
    (workflow.status !== "published" || workflow.auditStatus !== "approved")
  )
    throw new Error("项目流程尚未发布或未通过审核，无法发起运行。");
  const storedPlan = readJson(
    workflow.publishedExecutionPlanJson
  ) as WorkflowExecutionPlan | null;
  const executablePlan =
    storedPlan && workflow.publishedExecutionPlanHash
      ? assertWorkflowExecutionPlan(
          storedPlan,
          String(workflow.publishedExecutionPlanHash),
          workflow.flowType
        )
      : compileWorkflowDefinition(readJson(workflow.definitionJson), {
          flowType: workflow.flowType,
        }).plan;
  const executableDefinition = executablePlan.definition;
  const requestedIdempotencyKey = input.idempotencyKey?.trim();
  const jobIdempotencyKey = requestedIdempotencyKey
    ? `workflow:start:${input.workflowId}:${input.triggeredBy.id}:${requestedIdempotencyKey}`
    : `workflow:start:${randomUUID()}`;
  const [existingJobs] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,runId,status FROM workflow_run_job WHERE idempotencyKey=? LIMIT 1",
    [jobIdempotencyKey]
  );
  if (existingJobs[0]) {
    return {
      runId: String(existingJobs[0].runId),
      jobId: String(existingJobs[0].id),
      status: "queued" as const,
      deduplicated: true,
    };
  }

  const runId = randomUUID();
  const jobId = randomUUID();
  const startNode = executableDefinition.nodes.find(
    node => node.type === "start"
  );
  if (!startNode) throw new Error("流程缺少开始节点。");
  const context: JsonRecord = {
    input: input.workflowInput ?? {},
    vars: {},
    nodes: {},
    runtime: {
      executionRunId: runId,
      triggeredByUserId: input.triggeredBy.id,
      lastActorUserId: input.triggeredBy.id,
      participantUserIds: [input.triggeredBy.id],
      requestId: input.requestId ?? currentRequestId() ?? null,
      roleKeysByUser: {
        [String(input.triggeredBy.id)]: ["default", "initiator", "sender"],
      },
      executionQueue: [startNode.id],
      executionCurrentNodeId: null,
    },
  };
  setRuntimeNodeParticipants(context, startNode.id, [input.triggeredBy.id]);
  const authorizationSnapshot = {
    userId: input.triggeredBy.id,
    userRole: input.triggeredBy.role,
    permission: "workflow:run",
    authorizedAt: new Date().toISOString(),
  };
  const checkpoint: WorkflowCheckpoint = {
    queue: [startNode.id],
    context,
    finalOutput: null,
    currentNodeId: null,
  };
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [lockedWorkflowRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT archivedAt,flowType FROM workflow WHERE id=? LIMIT 1 FOR UPDATE",
      [input.workflowId]
    );
    if (!lockedWorkflowRows[0]) throw new Error("流程不存在。");
    if (lockedWorkflowRows[0].archivedAt)
      throw new Error("已归档流程不能发起运行，请先恢复流程。");
    if (String(lockedWorkflowRows[0].flowType) === "data")
      throw new Error("数据流程必须通过数据流运行入口启动。");
    await connection.query(
      "INSERT INTO workflow_run (id,workflowId,ownerUserId,triggeredByUserId,triggerType,status,definitionSnapshotJson,inputJson,contextJson,authorizationSnapshotJson,executionPlanJson,executionPlanHash,requestId) VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?)",
      [
        runId,
        input.workflowId,
        workflow.ownerUserId,
        input.triggeredBy.id,
        "manual",
        JSON.stringify(executableDefinition),
        JSON.stringify(input.workflowInput ?? {}),
        JSON.stringify(context),
        JSON.stringify(authorizationSnapshot),
        JSON.stringify(executablePlan),
        hashWorkflowExecutionPlan(executablePlan),
        input.requestId ?? currentRequestId() ?? null,
      ]
    );
    await connection.query(
      "INSERT INTO workflow_run_job (id,runId,jobType,status,idempotencyKey,checkpointJson,maxAttempts,requestId) VALUES (?,?,'start','queued',?,?,?,?)",
      [
        jobId,
        runId,
        jobIdempotencyKey,
        JSON.stringify(checkpoint),
        WORKFLOW_JOB_MAX_ATTEMPTS,
        input.requestId ?? currentRequestId() ?? null,
      ]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (requestedIdempotencyKey) {
      const [duplicates] = await db().query<mysql.RowDataPacket[]>(
        "SELECT id,runId FROM workflow_run_job WHERE idempotencyKey=? LIMIT 1",
        [jobIdempotencyKey]
      );
      if (duplicates[0])
        return {
          runId: String(duplicates[0].runId),
          jobId: String(duplicates[0].id),
          status: "queued" as const,
          deduplicated: true,
        };
    }
    throw error;
  } finally {
    connection.release();
  }
  return { runId, jobId, status: "queued" as const, deduplicated: false };
}

export async function executePreparedWorkflowRun(input: {
  runId: string;
  leaseToken?: string;
  checkpoint?: WorkflowCheckpoint;
  onCheckpoint?: (checkpoint: WorkflowCheckpoint) => Promise<void>;
}): Promise<WorkflowExecutionResult> {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT r.*,w.name,w.projectId FROM workflow_run r
       JOIN workflow w ON w.id=r.workflowId WHERE r.id=? LIMIT 1`,
    [input.runId]
  );
  const run = rows[0] as PersistedWorkflow | undefined;
  if (!run) throw new Error("流程运行不存在。");
  if (
    ["success", "failed", "cancelled", "terminated"].includes(
      String(run.status)
    )
  )
    throw new Error(`流程运行已结束：${run.status}。`);
  const definition = readJson(run.definitionSnapshotJson) as Definition;
  const persistedContext = asRecord(readJson(run.contextJson));
  const context = input.checkpoint?.context
    ? asRecord(input.checkpoint.context)
    : persistedContext;
  const runtime = asRecord(context.runtime);
  const suppliedCheckpoint = input.checkpoint ?? {
    queue: Array.isArray(runtime.executionQueue)
      ? runtime.executionQueue.map(String)
      : [],
    context,
    finalOutput: runtime.executionFinalOutput,
    currentNodeId:
      typeof runtime.executionCurrentNodeId === "string"
        ? runtime.executionCurrentNodeId
        : null,
  };
  const startNode = definition.nodes.find(node => node.type === "start");
  const queue = suppliedCheckpoint.queue.length
    ? [...suppliedCheckpoint.queue]
    : startNode
      ? [startNode.id]
      : [];
  const runStartedAt = run.startedAt
    ? new Date(run.startedAt).getTime()
    : Date.now();
  const persistCheckpoint = async (checkpoint: WorkflowCheckpoint) => {
    const nextRuntime = asRecord(checkpoint.context.runtime);
    nextRuntime.executionQueue = checkpoint.queue;
    nextRuntime.executionCurrentNodeId = checkpoint.currentNodeId ?? null;
    nextRuntime.executionFinalOutput = checkpoint.finalOutput ?? null;
    checkpoint.context.runtime = nextRuntime;
    if (input.onCheckpoint) {
      await input.onCheckpoint(checkpoint);
      return;
    }
    const params: unknown[] = [JSON.stringify(checkpoint.context), input.runId];
    const leaseClause = input.leaseToken ? " AND executionLockToken=?" : "";
    if (input.leaseToken) params.push(input.leaseToken);
    const [updated] = await db().query<mysql.ResultSetHeader>(
      `UPDATE workflow_run SET contextJson=? WHERE id=?${leaseClause}`,
      params
    );
    if (!updated.affectedRows)
      throw new Error("工作流执行租约已失效，已停止当前 Worker。");
  };

  const segment = await executeRunSegment({
    runId: input.runId,
    workflow: run,
    definition,
    context,
    queue,
    finalOutput: suppliedCheckpoint.finalOutput,
    checkpoint: persistCheckpoint,
  });
  if (segment.status === "waiting") {
    const waitingParams: unknown[] = [input.runId];
    const waitingLeaseClause = input.leaseToken
      ? " AND executionLockToken=?"
      : "";
    if (input.leaseToken) waitingParams.push(input.leaseToken);
    const [waiting] = await db().query<mysql.ResultSetHeader>(
      `UPDATE workflow_run SET status='waiting',executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=?${waitingLeaseClause} AND status='running'`,
      waitingParams
    );
    if (!waiting.affectedRows)
      throw new Error("流程状态已变化，无法进入等待。 ");
    return { runId: input.runId, status: "waiting", taskId: segment.taskId };
  }
  const params: unknown[] = [
    JSON.stringify(context),
    JSON.stringify(segment.output),
    Date.now() - runStartedAt,
    input.runId,
  ];
  const leaseClause = input.leaseToken ? " AND executionLockToken=?" : "";
  if (input.leaseToken) params.push(input.leaseToken);
  const [finished] = await db().query<mysql.ResultSetHeader>(
    `UPDATE workflow_run SET status='success',contextJson=?,finalOutputJson=?,errorJson=NULL,finishedAt=NOW(),durationMs=?,executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=?${leaseClause}`,
    params
  );
  if (!finished.affectedRows)
    throw new Error("工作流执行租约已失效，禁止重复完成运行。");
  return { runId: input.runId, status: "success", output: segment.output };
}

export async function markWorkflowRunFailed(
  runId: string,
  error: unknown,
  leaseToken?: string
) {
  const details = {
    message: error instanceof Error ? error.message : String(error),
  };
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT r.id,r.workflowId,r.ownerUserId,r.triggeredByUserId,r.startedAt,w.name
         FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE r.id=? LIMIT 1 FOR UPDATE`,
      [runId]
    );
    const run = rows[0];
    if (!run) {
      await connection.rollback();
      return false;
    }
    const params: unknown[] = [
      JSON.stringify(details),
      run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0,
      runId,
    ];
    const leaseClause = leaseToken ? " AND executionLockToken=?" : "";
    if (leaseToken) params.push(leaseToken);
    const [failed] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE workflow_run SET status='failed',errorJson=?,finishedAt=NOW(),durationMs=?,executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=?${leaseClause}`,
      params
    );
    if (!failed.affectedRows) {
      await connection.rollback();
      return false;
    }
    await createFailureAlerts(
      {
        workflowId: String(run.workflowId),
        workflowName: String(run.name),
        runId,
        ownerUserId: Number(run.ownerUserId),
        triggeredByUserId: Number(run.triggeredByUserId),
        details,
      },
      connection
    );
    await connection.commit();
    return true;
  } catch (failureError) {
    await connection.rollback();
    throw failureError;
  } finally {
    connection.release();
  }
}

export type WorkflowRunControlAction = "cancel" | "terminate";

/** Idempotently stops queued/running/waiting work and prevents a leased worker from committing it. */
export async function controlWorkflowRun(input: {
  runId: string;
  action: WorkflowRunControlAction;
  reason?: string;
}) {
  const targetStatus =
    input.action === "terminate" ? "terminated" : "cancelled";
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,status FROM workflow_run WHERE id=? FOR UPDATE",
      [input.runId]
    );
    const run = rows[0];
    if (!run) {
      await connection.rollback();
      return null;
    }
    const currentStatus = String(run.status);
    if (
      ["success", "failed", "cancelled", "terminated"].includes(currentStatus)
    ) {
      await connection.commit();
      return { runId: input.runId, status: currentStatus, changed: false };
    }
    await connection.query(
      "UPDATE workflow_run SET status=?,errorJson=?,finishedAt=NOW(),executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=?",
      [
        targetStatus,
        input.reason
          ? JSON.stringify({
              message: input.reason,
              controlledBy: input.action,
            })
          : null,
        input.runId,
      ]
    );
    await connection.query(
      "UPDATE workflow_run_job SET status='cancelled',leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW() WHERE runId=? AND status IN ('queued','leased')",
      [input.runId]
    );
    await connection.query(
      "UPDATE workflow_task SET status='cancelled',completedAt=NOW() WHERE runId=? AND status IN ('pending','claimed')",
      [input.runId]
    );
    await connection.commit();
    return { runId: input.runId, status: targetStatus, changed: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Pauses only at a persisted checkpoint; an actively executing node must finish first. */
export async function pauseWorkflowRun(runId: string) {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,status,contextJson FROM workflow_run WHERE id=? FOR UPDATE",
      [runId]
    );
    const run = rows[0];
    if (!run) {
      await connection.rollback();
      return null;
    }
    const status = String(run.status);
    if (status === "blocked") {
      await connection.commit();
      return { runId, status: "blocked" as const, changed: false };
    }
    if (!["queued", "waiting"].includes(status)) {
      throw new Error(
        status === "running"
          ? "当前节点仍在执行，请稍后在 Checkpoint 后暂停。"
          : "当前流程状态不支持暂停。"
      );
    }
    await connection.query(
      "UPDATE workflow_run SET status='blocked',executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=? AND status IN ('queued','waiting')",
      [runId]
    );
    await connection.query(
      "UPDATE workflow_run_job SET status='cancelled',leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW() WHERE runId=? AND status='queued'",
      [runId]
    );
    await connection.commit();
    return { runId, status: "blocked" as const, changed: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Resumes a blocked run from its last durable queue/context snapshot. */
export async function resumeWorkflowRun(runId: string) {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,status,contextJson,requestId FROM workflow_run WHERE id=? FOR UPDATE",
      [runId]
    );
    const run = rows[0];
    if (!run) {
      await connection.rollback();
      return null;
    }
    if (String(run.status) !== "blocked") {
      await connection.commit();
      return { runId, status: String(run.status), changed: false };
    }
    const context = asRecord(readJson(run.contextJson));
    const runtime = asRecord(context.runtime);
    const queue = Array.isArray(runtime.executionQueue)
      ? runtime.executionQueue.map(String).filter(Boolean)
      : [];
    const [pendingTasks] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_task WHERE runId=? AND status IN ('pending','claimed') ORDER BY createdAt,id LIMIT 1",
      [runId]
    );
    if (pendingTasks[0]) {
      await connection.query(
        "UPDATE workflow_run SET status='waiting',errorJson=NULL WHERE id=? AND status='blocked'",
        [runId]
      );
      await connection.commit();
      return {
        runId,
        status: "waiting" as const,
        taskId: String(pendingTasks[0].id),
        changed: true,
      };
    }
    if (!queue.length) throw new Error("流程没有可恢复的持久化执行队列。");
    const [existing] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_run_job WHERE runId=? AND jobType='resume' AND status IN ('queued','leased') ORDER BY createdAt DESC LIMIT 1",
      [runId]
    );
    if (existing[0]) {
      await connection.query(
        "UPDATE workflow_run SET status='queued',errorJson=NULL WHERE id=? AND status='blocked'",
        [runId]
      );
      await connection.commit();
      return {
        runId,
        status: "queued" as const,
        jobId: String(existing[0].id),
        changed: false,
      };
    }
    const jobId = randomUUID();
    const checkpoint: WorkflowCheckpoint = {
      queue,
      context,
      finalOutput: runtime.executionFinalOutput,
      currentNodeId:
        typeof runtime.executionCurrentNodeId === "string"
          ? runtime.executionCurrentNodeId
          : null,
    };
    await connection.query(
      "UPDATE workflow_run SET status='queued',errorJson=NULL WHERE id=? AND status='blocked'",
      [runId]
    );
    await connection.query(
      "INSERT INTO workflow_run_job (id,runId,jobType,status,idempotencyKey,checkpointJson,maxAttempts,requestId) VALUES (?,?,'resume','queued',?,?,?,?)",
      [
        jobId,
        runId,
        `workflow:resume-control:${runId}:${jobId}`,
        JSON.stringify(checkpoint),
        WORKFLOW_JOB_MAX_ATTEMPTS,
        String(
          run.requestId ?? runtime.requestId ?? currentRequestId() ?? ""
        ) || null,
      ]
    );
    await connection.commit();
    return { runId, status: "queued" as const, jobId, changed: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function executeWorkflow(input: {
  workflowId: string;
  triggeredBy: WorkflowUser;
  workflowInput?: JsonRecord;
  idempotencyKey?: string;
}) {
  const submitted = await submitWorkflowRun(input);
  if (submitted.deduplicated)
    throw new Error("同步兼容执行不接受重复幂等命令；请查询原运行状态。");
  const leaseToken = randomUUID().replaceAll("-", "").slice(0, 48);
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [leasedJob] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE workflow_run_job SET status='leased',attempt=attempt+1,leaseToken=?,leaseExpiresAt=DATE_ADD(NOW(),INTERVAL 2 MINUTE),workerId='inline' WHERE id=? AND status='queued'",
      [leaseToken, submitted.jobId]
    );
    if (!leasedJob.affectedRows)
      throw new Error("同步兼容执行未能领取持久化 Job。");
    const [leasedRun] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE workflow_run SET status='running',startedAt=COALESCE(startedAt,NOW()),executionLockToken=?,executionLockExpiresAt=DATE_ADD(NOW(),INTERVAL 2 MINUTE) WHERE id=? AND status IN ('queued','running','waiting')",
      [leaseToken, submitted.runId]
    );
    if (!leasedRun.affectedRows)
      throw new Error("同步兼容执行未能取得运行租约。");
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  try {
    const result = await executePreparedWorkflowRun({
      runId: submitted.runId,
      leaseToken,
    });
    await db().query(
      "UPDATE workflow_run_job SET status='completed',resultJson=?,leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW() WHERE id=? AND leaseToken=?",
      [JSON.stringify(result), submitted.jobId, leaseToken]
    );
    return result;
  } catch (error) {
    await markWorkflowRunFailed(submitted.runId, error, leaseToken);
    await db().query(
      "UPDATE workflow_run_job SET status='failed',lastErrorJson=?,leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW() WHERE id=? AND leaseToken=?",
      [
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }),
        submitted.jobId,
        leaseToken,
      ]
    );
    throw error;
  }
}

type PersistedWorkflow = mysql.RowDataPacket & {
  id: string;
  ownerUserId: number;
  projectId?: string | null;
  name: string;
  flowType: "state" | "control" | "data";
};
type RunSegmentResult =
  | { status: "success"; output: unknown }
  | { status: "waiting"; taskId: string };

function runtimeUserIds(context: JsonRecord) {
  const runtime = asRecord(context.runtime);
  const values = Array.isArray(runtime.participantUserIds)
    ? runtime.participantUserIds
    : [];
  return Array.from(
    new Set(values.map(Number).filter(id => Number.isInteger(id) && id > 0))
  );
}

function addRuntimeParticipants(context: JsonRecord, userIds: number[]) {
  const runtime = asRecord(context.runtime);
  runtime.participantUserIds = Array.from(
    new Set([
      ...runtimeUserIds(context),
      ...userIds.filter(id => Number.isInteger(id) && id > 0),
    ])
  );
  context.runtime = runtime;
}

function setRuntimeReceivers(context: JsonRecord, userIds: number[]) {
  const runtime = asRecord(context.runtime);
  runtime.receiverUserIds = Array.from(
    new Set(userIds.filter(id => Number.isInteger(id) && id > 0))
  );
  context.runtime = runtime;
}

function runtimeNodeParticipants(context: JsonRecord, nodeId: string) {
  const runtime = asRecord(context.runtime);
  const byNode = asRecord(runtime.nodeParticipantUserIds);
  const values = Array.isArray(byNode[nodeId])
    ? (byNode[nodeId] as unknown[])
    : [];
  return Array.from(
    new Set(values.map(Number).filter(id => Number.isInteger(id) && id > 0))
  );
}

function setRuntimeNodeParticipants(
  context: JsonRecord,
  nodeId: string,
  userIds: number[]
) {
  const runtime = asRecord(context.runtime);
  const byNode = asRecord(runtime.nodeParticipantUserIds);
  const existing = Array.isArray(byNode[nodeId])
    ? (byNode[nodeId] as unknown[]).map(Number)
    : [];
  byNode[nodeId] = Array.from(
    new Set(
      [...existing, ...userIds].filter(id => Number.isInteger(id) && id > 0)
    )
  );
  runtime.nodeParticipantUserIds = byNode;
  context.runtime = runtime;
}

function setCurrentNodeParticipants(context: JsonRecord, userIds: number[]) {
  const runtime = asRecord(context.runtime);
  runtime.currentNodeParticipantUserIds = Array.from(
    new Set(userIds.filter(id => Number.isInteger(id) && id > 0))
  );
  context.runtime = runtime;
}

function runtimeRoleKeys(context: JsonRecord, userId: number) {
  const runtime = asRecord(context.runtime);
  const rolesByUser = asRecord(runtime.roleKeysByUser);
  const configured = Array.isArray(rolesByUser[String(userId)])
    ? (rolesByUser[String(userId)] as unknown[])
    : [];
  return Array.from(
    new Set(["default", ...configured.map(String).filter(Boolean)])
  );
}

function updateRuntimeRoles(
  context: JsonRecord,
  userIds: number[],
  changes: TemporaryRoleChange[],
  contextualRole?: string
) {
  const runtime = asRecord(context.runtime);
  const rolesByUser = asRecord(runtime.roleKeysByUser);
  for (const userId of userIds.filter(id => Number.isInteger(id) && id > 0)) {
    const current = new Set(runtimeRoleKeys(context, userId));
    if (contextualRole) current.add(contextualRole);
    for (const change of changes)
      for (const roleKey of change.roleKeys)
        change.action === "add"
          ? current.add(roleKey)
          : current.delete(roleKey);
    rolesByUser[String(userId)] = Array.from(current);
  }
  runtime.roleKeysByUser = rolesByUser;
  context.runtime = runtime;
}

function configuredRoleKeys(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];
  return Array.from(
    new Set(
      items
        .map(item => {
          if (typeof item === "string" || typeof item === "number")
            return String(item).trim();
          const record = asRecord(item);
          return String(
            record.roleCode ??
              record.roleKey ??
              record.code ??
              record.id ??
              record.key ??
              record.value ??
              ""
          ).trim();
        })
        .filter(Boolean)
    )
  );
}

function shouldAutomaticallyExecute(config: JsonRecord, context: JsonRecord) {
  const normalized = normalizeReferenceOperateConfig(config);
  if (!normalized.autoExecute) return false;
  if (normalized.hasUnsafeAutoExecuteCode)
    throw new Error(
      "操作节点包含原版自动执行代码，必须迁移为安全条件后才能运行。"
    );
  if (!normalized.autoExecuteConditions.length) return true;
  return normalized.autoExecuteConditions.every(item => {
    const condition = asRecord(item);
    if (condition.left === undefined || condition.operator === undefined)
      throw new Error(
        "操作节点自动执行条件无法安全解释，请配置左值、操作符和右值。"
      );
    return compareCondition(
      interpolate(condition.left, context),
      String(condition.operator),
      interpolate(condition.right, context)
    );
  });
}

async function upsertParticipantState(input: {
  runId: string;
  workflowId: string;
  userId: number;
  roleKey?: string;
  stateCode?: string;
  stateName: string;
  flowStatus?: string;
  stateColor?: string;
  sourceNodeId?: string;
  availableOperations?: unknown[];
}) {
  await db().query(
    "INSERT INTO workflow_participant_state (id,runId,workflowId,userId,roleKey,stateCode,stateName,flowStatus,stateColor,sourceNodeId,availableOperationsJson) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE stateCode=VALUES(stateCode),stateName=VALUES(stateName),flowStatus=VALUES(flowStatus),stateColor=VALUES(stateColor),sourceNodeId=VALUES(sourceNodeId),availableOperationsJson=VALUES(availableOperationsJson),updatedAt=NOW()",
    [
      randomUUID(),
      input.runId,
      input.workflowId,
      input.userId,
      input.roleKey ?? "default",
      input.stateCode ?? null,
      input.stateName,
      input.flowStatus ?? input.stateName,
      input.stateColor ?? null,
      input.sourceNodeId ?? null,
      JSON.stringify(input.availableOperations ?? []),
    ]
  );
}

function stateConfiguredOperations(config: JsonRecord) {
  const operations: JsonRecord[] = [];
  for (const item of Array.isArray(config.ywcz) ? config.ywcz : []) {
    const record = asRecord(item);
    const code = String(record.czid ?? record.flowOprateCode ?? "").trim();
    const name = String(record.czmc ?? record.flowOprateName ?? "").trim();
    if (code && name) operations.push({ code, name, type: "business" });
  }
  for (const item of Array.isArray(config.jdgycz) ? config.jdgycz : []) {
    const record = asRecord(item);
    if (record.bj)
      operations.push({ code: "bj", name: "办结", type: "innate" });
    if (record.cs)
      operations.push({ code: "cs", name: "抄送", type: "innate" });
    if (record.ch)
      operations.push({ code: "ch", name: "撤回", type: "innate" });
  }
  return operations;
}

async function persistStateNode(input: {
  runId: string;
  workflowId: string;
  node: WorkflowNode;
  context: JsonRecord;
}) {
  const config = asRecord(resolveTemplates(input.node.config, input.context));
  const runtime = asRecord(input.context.runtime);
  const initiatorUserId = Number(runtime.triggeredByUserId);
  const actorUserId = Number(
    runtime.lastActorUserId || runtime.triggeredByUserId
  );
  const stateCode = String(
    firstConfiguredString(config.nodeDh, config.stateCode) ?? input.node.id
  );
  const stateName = String(
    firstConfiguredString(config.jdmc, config.displayName) ?? input.node.name
  );
  const flowStatus = String(
    firstConfiguredString(config.flowStatus) ?? stateName
  );
  const stateColor = firstConfiguredString(config.stateColor);

  const currentParticipants = runtimeNodeParticipants(
    input.context,
    input.node.id
  );
  const participantUserIds = currentParticipants.length
    ? currentParticipants
    : Array.from(
        new Set(
          [initiatorUserId, actorUserId].filter(
            id => Number.isInteger(id) && id > 0
          )
        )
      );
  const iamRoles = await resolveWorkflowUserRoleKeys(
    participantUserIds,
    input.workflowId
  );
  const boundRoles = configuredRoleKeys(config.bdjs);
  const availableOperations = stateConfiguredOperations(config);
  for (const userId of participantUserIds) {
    const roles = Array.from(
      new Set([
        ...(iamRoles.get(userId) ?? ["default"]),
        ...runtimeRoleKeys(input.context, userId),
      ])
    );
    const stateRoles = boundRoles.length
      ? roles.filter(role => boundRoles.includes(role))
      : ["default"];
    for (const roleKey of stateRoles) {
      await upsertParticipantState({
        runId: input.runId,
        workflowId: input.workflowId,
        userId,
        roleKey,
        stateCode,
        stateName: userId === initiatorUserId ? flowStatus : stateName,
        flowStatus,
        stateColor,
        sourceNodeId: input.node.id,
        availableOperations,
      });
    }
  }
  addRuntimeParticipants(input.context, participantUserIds);
}

async function executeRunSegment(input: {
  runId: string;
  workflow: PersistedWorkflow;
  definition: Definition;
  context: JsonRecord;
  queue: string[];
  finalOutput?: unknown;
  checkpoint?: (checkpoint: WorkflowCheckpoint) => Promise<void>;
}): Promise<RunSegmentResult> {
  const nodes = new Map(input.definition.nodes.map(node => [node.id, node]));
  const executed = new Set<string>();
  let finalOutput: unknown = input.finalOutput ?? null;
  let reachedEnd = false;
  while (input.queue.length) {
    if (executed.size >= MAX_STEPS)
      throw new Error("流程执行超过最大节点步数，可能存在循环。");
    const nodeId = input.queue.shift()!;
    if (executed.has(nodeId)) continue;
    const node = nodes.get(nodeId);
    if (!node) throw new Error(`流程引用了不存在的节点：${nodeId}`);
    executed.add(nodeId);
    await input.checkpoint?.({
      queue: [nodeId, ...input.queue],
      context: input.context,
      finalOutput,
      currentNodeId: nodeId,
    });
    const currentParticipants = runtimeNodeParticipants(input.context, node.id);
    const executionRuntime = asRecord(input.context.runtime);
    executionRuntime.executionRunId = input.runId;
    executionRuntime.executionNodeId = node.id;
    input.context.runtime = executionRuntime;
    setCurrentNodeParticipants(
      input.context,
      currentParticipants.length
        ? currentParticipants
        : runtimeUserIds(input.context)
    );
    const nodeInput = redactSensitiveValues({
      context: JSON.parse(JSON.stringify(input.context)),
      config: node.config,
    }) as JsonRecord;
    const nodeRunId = await insertNodeRun(
      input.runId,
      node,
      nodeInput,
      String(
        asRecord(input.context.runtime).requestId ?? currentRequestId() ?? ""
      ) || null
    );
    const startedAt = Date.now();
    try {
      if (node.type === "operate") {
        const config = asRecord(resolveTemplates(node.config, input.context));
        const runtime = asRecord(input.context.runtime);
        const reference = normalizeReferenceOperateConfig(config);
        const senderUserId = Number(
          runtime.lastActorUserId || runtime.triggeredByUserId
        );
        updateRuntimeRoles(
          input.context,
          [senderUserId],
          reference.senderTemporaryRoles,
          "sender"
        );
        const relatedParticipants = await resolveAutoRelatedParticipantUserIds(
          config,
          input.context
        );
        addRuntimeParticipants(input.context, relatedParticipants);
        if (relatedParticipants.length) {
          setRuntimeReceivers(input.context, relatedParticipants);
          updateRuntimeRoles(
            input.context,
            relatedParticipants,
            reference.receiverTemporaryRoles,
            "receiver"
          );
        }

        if (shouldAutomaticallyExecute(config, input.context)) {
          const completedByUserId = Number(
            runtime.lastActorUserId || runtime.triggeredByUserId
          );
          const automaticOutput = {
            automatic: true,
            completedByUserId,
            operationName: String(
              firstConfiguredString(config.czmc, config.instruction) ??
                node.name
            ),
            relatedParticipantUserIds: relatedParticipants,
          };
          const vars = asRecord(input.context.vars);
          const nodeOutputs = asRecord(input.context.nodes);
          vars[node.id] = automaticOutput;
          nodeOutputs[node.id] = automaticOutput;
          input.context.vars = vars;
          input.context.nodes = nodeOutputs;
          await finishNodeRun(nodeRunId, "success", startedAt, automaticOutput);
          const automaticParticipants = Array.from(
            new Set([...currentParticipants, ...relatedParticipants])
          );
          input.definition.edges
            .filter(edge => edge.sourceNodeId === node.id)
            .forEach(edge => {
              setRuntimeNodeParticipants(
                input.context,
                edge.targetNodeId,
                automaticParticipants
              );
              input.queue.push(edge.targetNodeId);
            });
          await input.checkpoint?.({
            queue: [...input.queue],
            context: input.context,
            finalOutput,
            currentNodeId: null,
          });
          continue;
        }

        const assignment = await resolveOperateAssignees({
          config,
          context: input.context,
          workflowId: input.workflow.id,
        });
        let approverUserIds = assignment.candidateUserIds;
        if (
          reference.signMode !== "single" &&
          reference.signSelectorUserIds.length
        ) {
          approverUserIds = approverUserIds.filter(userId =>
            reference.signSelectorUserIds.includes(userId)
          );
          if (!approverUserIds.length)
            throw new Error("或签/会签指定方未命中当前操作候选人。");
        }
        if (reference.signMode !== "single" && !approverUserIds.length)
          throw new Error("或签/会签必须解析到至少一名审批人。");
        setRuntimeReceivers(input.context, approverUserIds);
        updateRuntimeRoles(
          input.context,
          approverUserIds,
          reference.receiverTemporaryRoles,
          "receiver"
        );
        const nextNodeIds = input.definition.edges
          .filter(edge => edge.sourceNodeId === node.id)
          .map(edge => edge.targetNodeId);
        const operationName = String(
          firstConfiguredString(
            config.czmc,
            config.instruction,
            config.description
          ) ?? node.name
        );
        const pendingStatusName = String(
          firstConfiguredString(config.pendingStatusName) ?? "待审批"
        );
        const taskRoleKey =
          assignment.mode === "role"
            ? String(config.assigneeRoleCode || "default")
            : "default";
        const approvalGroupId =
          reference.signMode === "single" ? null : randomUUID();
        if (approvalGroupId) {
          const requiredApprovals = approvalRequirement(
            reference.signMode,
            approverUserIds.length,
            reference.passPercent
          );
          await db().query(
            "INSERT INTO workflow_task_group (id,workflowId,runId,nodeId,signMode,totalApprovers,requiredApprovals,passPercentBasisPoints,nextNodeIdsJson,requestId) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
              approvalGroupId,
              input.workflow.id,
              input.runId,
              node.id,
              reference.signMode,
              approverUserIds.length,
              requiredApprovals,
              Math.round(reference.passPercent * 10000),
              JSON.stringify(nextNodeIds),
              String(
                asRecord(input.context.runtime).requestId ??
                  currentRequestId() ??
                  ""
              ) || null,
            ]
          );
        }
        const sequentialSign = reference.signMode === "sequentialSignFor";
        const taskAssignments = approvalGroupId
          ? approverUserIds.map((userId, approvalOrder) => ({
              assignedUserId: userId,
              candidateUserIds: [userId],
              approvalOrder,
            }))
          : [
              {
                assignedUserId: assignment.assignedUserId,
                candidateUserIds: approverUserIds,
                approvalOrder: 0,
              },
            ];
        const taskIds: string[] = [];
        for (const taskAssignment of taskAssignments) {
          const taskId = randomUUID();
          taskIds.push(taskId);
          await db().query(
            "INSERT INTO workflow_task (id,workflowId,projectId,runId,nodeId,nodeName,assignedUserId,candidateUserIdsJson,approvalGroupId,signMode,approvalOrder,roleKey,operationName,pendingStatusName,instruction,payloadJson,nextNodeIdsJson,requestId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
              taskId,
              input.workflow.id,
              input.workflow.projectId ?? null,
              input.runId,
              node.id,
              node.name,
              taskAssignment.assignedUserId,
              taskAssignment.candidateUserIds.length
                ? JSON.stringify(taskAssignment.candidateUserIds)
                : null,
              approvalGroupId,
              reference.signMode,
              taskAssignment.approvalOrder,
              taskRoleKey,
              operationName,
              pendingStatusName,
              String(
                firstConfiguredString(config.instruction) ?? operationName
              ),
              JSON.stringify({
                config,
                context: input.context,
                assignmentMode: assignment.mode,
                reference,
              }),
              JSON.stringify(nextNodeIds),
              String(
                asRecord(input.context.runtime).requestId ??
                  currentRequestId() ??
                  ""
              ) || null,
            ]
          );
          for (const userId of taskAssignment.candidateUserIds) {
            const availableOperation = {
              taskId,
              name: operationName,
              ...(reference.signMode === "single"
                ? {}
                : { signMode: reference.signMode }),
            };
            await upsertParticipantState({
              runId: input.runId,
              workflowId: input.workflow.id,
              userId,
              roleKey: taskRoleKey,
              stateCode: node.id,
              stateName: pendingStatusName,
              flowStatus: pendingStatusName,
              sourceNodeId: node.id,
              availableOperations:
                !sequentialSign || taskAssignment.approvalOrder === 0
                  ? [availableOperation]
                  : [],
            });
          }
        }
        addRuntimeParticipants(input.context, approverUserIds);
        await finishNodeRun(nodeRunId, "waiting", startedAt, {
          taskId: taskIds[0],
          taskIds,
          approvalGroupId,
          signMode: reference.signMode,
          status: "pending",
          assignedUserId: assignment.assignedUserId,
          candidateUserIds: approverUserIds,
          operationName,
        });
        await input.checkpoint?.({
          queue: [],
          context: input.context,
          finalOutput,
          currentNodeId: null,
        });
        return { status: "waiting", taskId: taskIds[0] };
      }
      if (node.type === "router") {
        const routeParticipants = runtimeNodeParticipants(
          input.context,
          node.id
        );
        const iamRoles = await resolveWorkflowUserRoleKeys(
          routeParticipants,
          input.workflow.id
        );
        const runtime = asRecord(input.context.runtime);
        const rolesByUser = asRecord(runtime.roleKeysByUser);
        for (const userId of routeParticipants) {
          rolesByUser[String(userId)] = Array.from(
            new Set([
              ...(Array.isArray(rolesByUser[String(userId)])
                ? (rolesByUser[String(userId)] as unknown[])
                : []),
              ...(iamRoles.get(userId) ?? []),
            ])
          );
        }
        runtime.roleKeysByUser = rolesByUser;
        input.context.runtime = runtime;
      }
      let nodeFailure: JsonRecord | undefined;
      let result: { output: unknown; route?: string; routeTargets?: unknown[] };
      try {
        result = await executeNode(
          node,
          input.context,
          true,
          Number(input.workflow.ownerUserId)
        );
      } catch (error) {
        const failureHandle =
          node.type === "llm"
            ? String(node.config.failureHandle ?? "").trim()
            : "";
        if (!failureHandle) throw error;
        nodeFailure = {
          code: "LLM_NODE_FAILED",
          message: error instanceof Error ? error.message : String(error),
          failureHandle,
        };
        result = {
          output: { failed: true, ...nodeFailure },
          route: failureHandle,
        };
      }
      const vars = asRecord(input.context.vars);
      const nodeOutputs = asRecord(input.context.nodes);
      vars[node.id] = result.output;
      nodeOutputs[node.id] = result.output;
      input.context.vars = vars;
      input.context.nodes = nodeOutputs;
      if (node.type === "start") Object.assign(vars, asRecord(result.output));
      if (node.type === "state")
        await persistStateNode({
          runId: input.runId,
          workflowId: input.workflow.id,
          node,
          context: input.context,
        });
      if (node.type === "end") {
        reachedEnd = true;
        finalOutput = result.output;
      }
      await finishNodeRun(
        nodeRunId,
        nodeFailure ? "failed" : "success",
        startedAt,
        result.output,
        nodeFailure
      );
      const routed = result as { route?: string; routeTargets?: unknown[] };
      const routeTargets = Array.isArray(routed.routeTargets)
        ? routed.routeTargets.map(asRecord)
        : [];
      if (node.type === "router" && routeTargets.length) {
        for (const branch of routeTargets) {
          const handle = String(branch.handle ?? routed.route ?? "default");
          const targetNodeId = String(branch.targetNodeId ?? "");
          const branchUsers = Array.isArray(branch.userIds)
            ? branch.userIds
                .map(Number)
                .filter(id => Number.isInteger(id) && id > 0)
            : currentParticipants;
          const edges = input.definition.edges.filter(
            edge =>
              edge.sourceNodeId === node.id &&
              ((targetNodeId && edge.targetNodeId === targetNodeId) ||
                (!targetNodeId &&
                  (edge.sourceHandle ?? "default") === handle) ||
                (edge.sourceHandle ?? "default") === handle)
          );
          for (const edge of edges) {
            setRuntimeNodeParticipants(
              input.context,
              edge.targetNodeId,
              branchUsers
            );
            input.queue.push(edge.targetNodeId);
          }
        }
      } else {
        input.definition.edges
          .filter(
            edge =>
              edge.sourceNodeId === node.id &&
              (!routed.route ||
                (edge.sourceHandle ?? "default") === routed.route)
          )
          .forEach(edge => {
            setRuntimeNodeParticipants(
              input.context,
              edge.targetNodeId,
              currentParticipants
            );
            input.queue.push(edge.targetNodeId);
          });
      }
      const completedRuntime = asRecord(input.context.runtime);
      completedRuntime.executionNodeId = null;
      input.context.runtime = completedRuntime;
      await input.checkpoint?.({
        queue: [...input.queue],
        context: input.context,
        finalOutput,
        currentNodeId: null,
      });
    } catch (error) {
      const details = {
        message: error instanceof Error ? error.message : String(error),
      };
      await finishNodeRun(nodeRunId, "failed", startedAt, undefined, details);
      throw error;
    }
  }
  if (!reachedEnd)
    throw new Error("流程未到达结束节点，已阻止将不完整运行标记为成功。");
  await input.checkpoint?.({
    queue: [],
    context: input.context,
    finalOutput,
    currentNodeId: null,
  });
  return { status: "success", output: finalOutput };
}

type ApprovalGateResult = {
  continueFlow: boolean;
  rejected: boolean;
  completedApprovals: number;
  rejectedApprovals: number;
  completedDecisions: number;
  requiredApprovals: number;
  totalApprovers: number;
  affectedUserIds: number[];
  pendingTaskId?: string;
  groupResults?: unknown[];
};

async function completeTaskAndEvaluateApprovalGroup(
  task: mysql.RowDataPacket,
  input: { taskId: string; completedBy: WorkflowUser; result: JsonRecord }
): Promise<ApprovalGateResult> {
  const result = normalizeApprovalResult(input.result);
  if (!task.approvalGroupId) {
    const [claim] = await db().query<mysql.ResultSetHeader>(
      "UPDATE workflow_task SET status='completed',completedByUserId=?,resultJson=?,completedAt=NOW() WHERE id=? AND status='claimed'",
      [input.completedBy.id, JSON.stringify(result), input.taskId]
    );
    if (!claim.affectedRows) throw new Error("人工任务已被其他操作处理。 ");
    const rejected = result.decision === "rejected";
    return {
      continueFlow: !rejected,
      rejected,
      completedApprovals: rejected ? 0 : 1,
      rejectedApprovals: rejected ? 1 : 0,
      completedDecisions: 1,
      requiredApprovals: 1,
      totalApprovers: 1,
      affectedUserIds: [input.completedBy.id],
      groupResults: [result],
    };
  }

  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [lockedTasks] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task WHERE id=? FOR UPDATE",
      [input.taskId]
    );
    const lockedTask = lockedTasks[0];
    if (
      !lockedTask ||
      lockedTask.status !== "claimed" ||
      (Number(lockedTask.claimedByUserId) !== input.completedBy.id &&
        input.completedBy.role !== "admin")
    ) {
      throw new Error("人工任务已被其他操作处理。 ");
    }
    const [groups] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task_group WHERE id=? FOR UPDATE",
      [task.approvalGroupId]
    );
    const group = groups[0];
    if (!group || group.status !== "waiting")
      throw new Error("或签/会签任务组已结束。 ");
    await connection.query(
      "UPDATE workflow_task SET status='completed',completedByUserId=?,resultJson=?,completedAt=NOW() WHERE id=?",
      [input.completedBy.id, JSON.stringify(result), input.taskId]
    );
    const requiredApprovals = Number(group.requiredApprovals);
    const totalApprovers = Number(group.totalApprovers);
    const [members] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,assignedUserId,status,resultJson FROM workflow_task WHERE approvalGroupId=? ORDER BY createdAt,id",
      [task.approvalGroupId]
    );
    const affectedUserIds = Array.from(
      new Set(
        members
          .map(row => Number(row.assignedUserId))
          .filter(id => Number.isInteger(id) && id > 0)
      )
    );
    const groupResults = members
      .filter(row => row.status === "completed")
      .map(row => readJson(row.resultJson));
    const progress = evaluateApprovalResults({
      totalApprovers,
      requiredApprovals,
      results: groupResults,
    });
    if (progress.outcome === "waiting") {
      if (String(task.signMode) === "sequentialSignFor") {
        const [nextTasks] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT id,assignedUserId,operationName FROM workflow_task WHERE approvalGroupId=? AND status='pending' ORDER BY approvalOrder,id LIMIT 1",
          [task.approvalGroupId]
        );
        const next = nextTasks[0];
        if (next) {
          await connection.query(
            "UPDATE workflow_participant_state SET availableOperationsJson=?,updatedAt=NOW() WHERE runId=? AND userId=?",
            [
              JSON.stringify([
                {
                  taskId: String(next.id),
                  name: String(next.operationName ?? task.nodeName),
                  signMode: "sequentialSignFor",
                },
              ]),
              task.runId,
              Number(next.assignedUserId),
            ]
          );
        }
      }
      const pendingTaskId = String(
        members.find(
          row => row.status === "pending" || row.status === "claimed"
        )?.id ?? ""
      );
      await connection.commit();
      return {
        continueFlow: false,
        rejected: false,
        completedApprovals: progress.approved,
        rejectedApprovals: progress.rejected,
        completedDecisions: progress.completed,
        requiredApprovals,
        totalApprovers,
        affectedUserIds: [input.completedBy.id],
        pendingTaskId: pendingTaskId || undefined,
      };
    }
    const rejected = progress.outcome === "rejected";
    await connection.query(
      "UPDATE workflow_task_group SET status=?,completedByTaskId=?,completedAt=NOW() WHERE id=? AND status='waiting'",
      [rejected ? "cancelled" : "completed", input.taskId, task.approvalGroupId]
    );
    await connection.query(
      "UPDATE workflow_task SET status='cancelled' WHERE approvalGroupId=? AND status IN ('pending','claimed')",
      [task.approvalGroupId]
    );
    await connection.commit();
    return {
      continueFlow: !rejected,
      rejected,
      completedApprovals: progress.approved,
      rejectedApprovals: progress.rejected,
      completedDecisions: progress.completed,
      requiredApprovals,
      totalApprovers,
      affectedUserIds,
      groupResults,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function resumeWorkflowTask(input: {
  taskId: string;
  completedBy: WorkflowUser;
  result: JsonRecord;
}) {
  const normalizedResult = normalizeApprovalResult(input.result);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,r.contextJson,r.definitionSnapshotJson,r.status AS runStatus,r.startedAt,w.ownerUserId,w.name AS workflowName,w.projectId
       FROM workflow_task t JOIN workflow_run r ON r.id=t.runId JOIN workflow w ON w.id=t.workflowId WHERE t.id=? LIMIT 1`,
    [input.taskId]
  );
  const task = rows[0] as PersistedWorkflow & mysql.RowDataPacket;
  if (!task) throw new Error("人工任务不存在。 ");
  if (
    task.status !== "claimed" ||
    Number(task.claimedByUserId) !== input.completedBy.id
  )
    throw new Error("仅领取该任务的处理人可以完成操作。 ");
  if (!["running", "waiting"].includes(String(task.runStatus)))
    throw new Error("所属流程实例不处于等待人工操作状态。 ");
  const gate = await completeTaskAndEvaluateApprovalGroup(task, {
    ...input,
    result: normalizedResult,
  });
  const individualDecision = normalizedResult.decision as ApprovalDecision;
  await db().query(
    "UPDATE workflow_participant_state SET stateName=?,flowStatus=?,availableOperationsJson=?,updatedAt=NOW() WHERE runId=? AND userId=? AND roleKey=?",
    [
      individualDecision === "rejected" ? "已拒绝" : "已审核",
      individualDecision === "rejected" ? "已拒绝" : "已审核",
      JSON.stringify([]),
      task.runId,
      input.completedBy.id,
      String(task.roleKey || "default"),
    ]
  );
  if (!gate.continueFlow && !gate.rejected) {
    return {
      runId: String(task.runId),
      status: "waiting" as const,
      taskId: gate.pendingTaskId ?? input.taskId,
      approvalProgress: {
        completed: gate.completedApprovals,
        approved: gate.completedApprovals,
        rejected: gate.rejectedApprovals,
        decided: gate.completedDecisions,
        required: gate.requiredApprovals,
        total: gate.totalApprovers,
      },
    };
  }
  const context = asRecord(readJson(task.contextJson));
  const runtime = asRecord(context.runtime);
  runtime.lastActorUserId = input.completedBy.id;
  context.runtime = runtime;
  updateRuntimeRoles(context, [input.completedBy.id], [], "sender");
  addRuntimeParticipants(context, [input.completedBy.id]);
  if (gate.affectedUserIds.length) {
    const placeholders = gate.affectedUserIds.map(() => "?").join(",");
    await db().query(
      "UPDATE workflow_participant_state SET availableOperationsJson=?,updatedAt=NOW() WHERE runId=? AND userId IN (" +
        placeholders +
        ")",
      [JSON.stringify([]), task.runId, ...gate.affectedUserIds]
    );
  }
  const taskOutput = {
    taskId: input.taskId,
    approvalGroupId: task.approvalGroupId ?? null,
    signMode: task.signMode ?? "single",
    completedByUserId: input.completedBy.id,
    operationName: task.operationName ?? task.nodeName,
    decision: gate.rejected ? "rejected" : "approved",
    result: normalizedResult,
    groupResults: gate.groupResults ?? [normalizedResult],
    approvalProgress: {
      completed: gate.completedApprovals,
      approved: gate.completedApprovals,
      rejected: gate.rejectedApprovals,
      decided: gate.completedDecisions,
      required: gate.requiredApprovals,
      total: gate.totalApprovers,
    },
  };
  const vars = asRecord(context.vars);
  const nodeOutputs = asRecord(context.nodes);
  vars[String(task.nodeId)] = taskOutput;
  nodeOutputs[String(task.nodeId)] = taskOutput;
  context.vars = vars;
  context.nodes = nodeOutputs;
  const [nodeRuns] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,startedAt FROM workflow_node_run WHERE runId=? AND nodeId=? AND status='waiting' ORDER BY createdAt DESC LIMIT 1",
    [task.runId, task.nodeId]
  );
  const waitingNodeRun = nodeRuns[0];
  if (!waitingNodeRun)
    throw new Error("人工任务对应的等待节点运行记录不存在。");
  if (gate.rejected) {
    const rejectionConnection = await db().getConnection();
    try {
      await rejectionConnection.beginTransaction();
      const [finishedNode] =
        await rejectionConnection.query<mysql.ResultSetHeader>(
          "UPDATE workflow_node_run SET status='success',outputJson=?,errorJson=NULL,finishedAt=NOW(),durationMs=? WHERE id=? AND status='waiting'",
          [
            JSON.stringify(taskOutput),
            Date.now() -
              new Date(waitingNodeRun.startedAt ?? Date.now()).getTime(),
            waitingNodeRun.id,
          ]
        );
      if (!finishedNode.affectedRows)
        throw new Error("人工任务节点已被其他请求推进。");
      const [cancelledRun] =
        await rejectionConnection.query<mysql.ResultSetHeader>(
          "UPDATE workflow_run SET status='cancelled',contextJson=?,finalOutputJson=?,finishedAt=NOW(),durationMs=?,executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=? AND status IN ('running','waiting')",
          [
            JSON.stringify(context),
            JSON.stringify(taskOutput),
            Date.now() - new Date(task.startedAt ?? Date.now()).getTime(),
            task.runId,
          ]
        );
      if (!cancelledRun.affectedRows)
        throw new Error("流程状态已变化，无法重复终止。");
      await rejectionConnection.commit();
    } catch (error) {
      await rejectionConnection.rollback();
      throw error;
    } finally {
      rejectionConnection.release();
    }
    return {
      runId: String(task.runId),
      status: "cancelled" as const,
      output: taskOutput,
    };
  }
  const nextNodeIds = readJson(task.nextNodeIdsJson);
  const continuationNodeIds = Array.isArray(nextNodeIds)
    ? nextNodeIds.map(String)
    : [];
  for (const nodeId of continuationNodeIds)
    setRuntimeNodeParticipants(context, nodeId, runtimeUserIds(context));
  const resumeRuntime = asRecord(context.runtime);
  resumeRuntime.executionRunId = String(task.runId);
  resumeRuntime.executionQueue = continuationNodeIds;
  resumeRuntime.executionCurrentNodeId = null;
  context.runtime = resumeRuntime;
  const checkpoint: WorkflowCheckpoint = {
    queue: continuationNodeIds,
    context,
    finalOutput: null,
    currentNodeId: null,
  };
  const jobId = randomUUID();
  const resumeIdentity = String(
    task.approvalGroupId || task.id || input.taskId
  );
  const idempotencyKey = `workflow:resume:${task.runId}:${resumeIdentity}`;
  const continuationConnection = await db().getConnection();
  try {
    await continuationConnection.beginTransaction();
    const [finishedNode] =
      await continuationConnection.query<mysql.ResultSetHeader>(
        "UPDATE workflow_node_run SET status='success',outputJson=?,errorJson=NULL,finishedAt=NOW(),durationMs=? WHERE id=? AND status='waiting'",
        [
          JSON.stringify(taskOutput),
          Date.now() -
            new Date(waitingNodeRun.startedAt ?? Date.now()).getTime(),
          waitingNodeRun.id,
        ]
      );
    if (!finishedNode.affectedRows)
      throw new Error("人工任务节点已被其他请求推进。");
    const [queuedRun] =
      await continuationConnection.query<mysql.ResultSetHeader>(
        "UPDATE workflow_run SET status='queued',contextJson=?,errorJson=NULL,executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=? AND status IN ('running','waiting')",
        [JSON.stringify(context), task.runId]
      );
    if (!queuedRun.affectedRows)
      throw new Error("流程状态已变化，无法重复提交续跑命令。");
    await continuationConnection.query(
      "INSERT INTO workflow_run_job (id,runId,jobType,status,idempotencyKey,checkpointJson,maxAttempts,requestId) VALUES (?,?,'resume','queued',?,?,?,?)",
      [
        jobId,
        task.runId,
        idempotencyKey,
        JSON.stringify(checkpoint),
        WORKFLOW_JOB_MAX_ATTEMPTS,
        String(task.requestId ?? currentRequestId() ?? "") || null,
      ]
    );
    await continuationConnection.commit();
    return {
      runId: String(task.runId),
      jobId,
      status: "queued" as const,
      approvalProgress: taskOutput.approvalProgress,
    };
  } catch (error) {
    await continuationConnection.rollback();
    throw error;
  } finally {
    continuationConnection.release();
  }
}

/**
 * Repairs the crash window after an approval decision commits but before its
 * continuation command is persisted. A grace period keeps the reconciler away
 * from an in-flight API request; row locks and the stable idempotency key make
 * repeated scans safe.
 */
export async function reconcileWorkflowContinuations(limit = 20) {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const [candidates] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,r.contextJson,r.startedAt AS runStartedAt,
            nr.id AS nodeRunId,nr.startedAt AS nodeRunStartedAt,
            g.status AS groupStatus,g.completedByTaskId,g.totalApprovers,g.requiredApprovals
       FROM workflow_task t
       JOIN workflow_run r ON r.id=t.runId AND r.status IN ('running','waiting')
       JOIN workflow_node_run nr ON nr.runId=t.runId AND nr.nodeId=t.nodeId AND nr.status='waiting'
       LEFT JOIN workflow_task_group g ON g.id=t.approvalGroupId
      WHERE t.status='completed' AND t.completedAt<DATE_SUB(NOW(),INTERVAL 10 SECOND)
        AND (t.approvalGroupId IS NULL OR g.completedByTaskId=t.id)
      ORDER BY t.completedAt ASC,t.id ASC LIMIT ?`,
    [safeLimit]
  );
  let repaired = 0;
  for (const task of candidates) {
    const connection = await db().getConnection();
    try {
      await connection.beginTransaction();
      const [lockedRuns] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,contextJson,startedAt FROM workflow_run WHERE id=? AND status IN ('running','waiting') FOR UPDATE",
        [task.runId]
      );
      const run = lockedRuns[0];
      if (!run) {
        await connection.rollback();
        continue;
      }
      const resumeIdentity = String(task.approvalGroupId || task.id);
      const idempotencyKey = `workflow:resume:${task.runId}:${resumeIdentity}`;
      const [existingJobs] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id FROM workflow_run_job WHERE idempotencyKey=? LIMIT 1",
        [idempotencyKey]
      );
      if (existingJobs[0]) {
        await connection.rollback();
        continue;
      }
      const [lockedNodeRuns] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,startedAt FROM workflow_node_run WHERE id=? AND status='waiting' FOR UPDATE",
        [task.nodeRunId]
      );
      const nodeRun = lockedNodeRuns[0];
      if (!nodeRun) {
        await connection.rollback();
        continue;
      }
      const [memberRows] = task.approvalGroupId
        ? await connection.query<mysql.RowDataPacket[]>(
            "SELECT id,assignedUserId,completedByUserId,roleKey,resultJson FROM workflow_task WHERE approvalGroupId=? AND status='completed' ORDER BY createdAt,id",
            [task.approvalGroupId]
          )
        : [[task] as mysql.RowDataPacket[], undefined];
      const groupResults = memberRows.map(member =>
        readJson(member.resultJson)
      );
      const lastMember = memberRows[memberRows.length - 1] ?? task;
      const rejected = task.approvalGroupId
        ? task.groupStatus === "cancelled"
        : normalizeApprovalResult(asRecord(readJson(task.resultJson)))
            .decision === "rejected";
      const approvedCount = groupResults.filter(
        item => normalizeApprovalResult(asRecord(item)).decision === "approved"
      ).length;
      const rejectedCount = groupResults.length - approvedCount;
      const taskOutput = {
        taskId: String(task.id),
        approvalGroupId: task.approvalGroupId ?? null,
        signMode: task.signMode ?? "single",
        completedByUserId: Number(
          lastMember.completedByUserId || lastMember.assignedUserId
        ),
        operationName: task.operationName ?? task.nodeName,
        decision: rejected ? "rejected" : "approved",
        result: readJson(task.resultJson),
        groupResults,
        approvalProgress: {
          completed: approvedCount,
          approved: approvedCount,
          rejected: rejectedCount,
          decided: groupResults.length,
          required: Number(task.requiredApprovals ?? 1),
          total: Number(task.totalApprovers ?? 1),
        },
        recoveredByWorker: true,
      };
      const context = asRecord(readJson(run.contextJson));
      const runtime = asRecord(context.runtime);
      runtime.lastActorUserId = taskOutput.completedByUserId;
      context.runtime = runtime;
      const vars = asRecord(context.vars);
      const nodeOutputs = asRecord(context.nodes);
      vars[String(task.nodeId)] = taskOutput;
      nodeOutputs[String(task.nodeId)] = taskOutput;
      context.vars = vars;
      context.nodes = nodeOutputs;
      await connection.query(
        "UPDATE workflow_node_run SET status='success',outputJson=?,errorJson=NULL,finishedAt=NOW(),durationMs=? WHERE id=?",
        [
          JSON.stringify(taskOutput),
          Date.now() - new Date(nodeRun.startedAt ?? Date.now()).getTime(),
          nodeRun.id,
        ]
      );
      if (task.approvalGroupId) {
        await connection.query(
          "UPDATE workflow_participant_state SET availableOperationsJson=?,updatedAt=NOW() WHERE runId=? AND userId IN (SELECT assignedUserId FROM workflow_task WHERE approvalGroupId=?)",
          [JSON.stringify([]), task.runId, task.approvalGroupId]
        );
      }
      if (rejected) {
        await connection.query(
          "UPDATE workflow_run SET status='cancelled',contextJson=?,finalOutputJson=?,finishedAt=NOW(),durationMs=?,executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=?",
          [
            JSON.stringify(context),
            JSON.stringify(taskOutput),
            Date.now() - new Date(run.startedAt ?? Date.now()).getTime(),
            task.runId,
          ]
        );
      } else {
        const nextNodeIds = readJson(task.nextNodeIdsJson);
        const queue = Array.isArray(nextNodeIds) ? nextNodeIds.map(String) : [];
        for (const nodeId of queue)
          setRuntimeNodeParticipants(context, nodeId, runtimeUserIds(context));
        const resumeRuntime = asRecord(context.runtime);
        resumeRuntime.executionRunId = String(task.runId);
        resumeRuntime.executionQueue = queue;
        resumeRuntime.executionCurrentNodeId = null;
        context.runtime = resumeRuntime;
        const checkpoint: WorkflowCheckpoint = {
          queue,
          context,
          finalOutput: null,
          currentNodeId: null,
        };
        await connection.query(
          "UPDATE workflow_run SET status='queued',contextJson=?,errorJson=NULL,executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=?",
          [JSON.stringify(context), task.runId]
        );
        await connection.query(
          "INSERT INTO workflow_run_job (id,runId,jobType,status,idempotencyKey,checkpointJson,maxAttempts,requestId) VALUES (?,?,'resume','queued',?,?,?,?)",
          [
            randomUUID(),
            task.runId,
            idempotencyKey,
            JSON.stringify(checkpoint),
            WORKFLOW_JOB_MAX_ATTEMPTS,
            String(task.requestId ?? currentRequestId() ?? "") || null,
          ]
        );
      }
      await connection.commit();
      repaired += 1;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  return repaired;
}

export async function listWorkflowRuns(
  workflowId: string,
  filters: RunFilters = {}
) {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT r.id,r.workflowId,r.triggeredByUserId,r.triggerType,r.status,r.inputJson,r.finalOutputJson,r.errorJson,r.startedAt,r.finishedAt,r.durationMs,r.createdAt,u.username,u.name AS triggeredByName
       FROM workflow_run r LEFT JOIN users u ON u.id=r.triggeredByUserId
      WHERE r.workflowId=? AND (? IS NULL OR r.status=?) AND (? IS NULL OR r.createdAt>=?) AND (? IS NULL OR r.createdAt<=?) AND (? IS NULL OR r.triggeredByUserId=?)
      ORDER BY r.createdAt DESC LIMIT ?`,
    [
      workflowId,
      filters.status ?? null,
      filters.status ?? null,
      filters.from ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.to ?? null,
      filters.triggeredByUserId ?? null,
      filters.triggeredByUserId ?? null,
      limit,
    ]
  );
  return rows;
}

export async function getWorkflowRunMetrics(
  workflowId: string,
  filters: Omit<RunFilters, "limit"> = {}
) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS totalRuns,COALESCE(SUM(status='success'),0) AS successfulRuns,COALESCE(SUM(status='failed'),0) AS failedRuns,COALESCE(ROUND(AVG(CASE WHEN status IN ('success','failed') THEN durationMs END)),0) AS averageDurationMs,COALESCE(MAX(durationMs),0) AS maxDurationMs
       FROM workflow_run WHERE workflowId=? AND (? IS NULL OR status=?) AND (? IS NULL OR createdAt>=?) AND (? IS NULL OR createdAt<=?) AND (? IS NULL OR triggeredByUserId=?)`,
    [
      workflowId,
      filters.status ?? null,
      filters.status ?? null,
      filters.from ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.to ?? null,
      filters.triggeredByUserId ?? null,
      filters.triggeredByUserId ?? null,
    ]
  );
  const row = rows[0] ?? {};
  const totalRuns = Number(row.totalRuns ?? 0);
  const failedRuns = Number(row.failedRuns ?? 0);
  return {
    totalRuns,
    successfulRuns: Number(row.successfulRuns ?? 0),
    failedRuns,
    averageDurationMs: Number(row.averageDurationMs ?? 0),
    maxDurationMs: Number(row.maxDurationMs ?? 0),
    failureRate: totalRuns
      ? Math.round((failedRuns / totalRuns) * 1000) / 10
      : 0,
  };
}

export async function listRunAlerts(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT a.*,w.name AS workflowName,r.status AS runStatus,r.durationMs,r.finishedAt
       FROM workflow_run_alert a JOIN workflow w ON w.id=a.workflowId JOIN workflow_run r ON r.id=a.runId
      WHERE a.recipientUserId=? ORDER BY a.readAt IS NULL DESC,a.createdAt DESC LIMIT 100`,
    [user.id]
  );
  return rows;
}

export async function markRunAlertRead(alertId: string, user: WorkflowUser) {
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow_run_alert SET readAt=COALESCE(readAt,NOW()) WHERE id=? AND recipientUserId=?",
    [alertId, user.id]
  );
  return Boolean(result.affectedRows);
}

export async function getWorkflowRun(
  runId: string
): Promise<WorkflowRunDetail | null> {
  const [runRows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_run WHERE id=? LIMIT 1",
    [runId]
  );
  const run = runRows[0];
  if (!run) return null;
  const [nodeRows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_node_run WHERE runId=? ORDER BY createdAt ASC,sequenceNo ASC,id ASC",
    [runId]
  );
  return { ...run, workflowId: String(run.workflowId), nodeRuns: nodeRows };
}

export async function getRuntimeModels() {
  const catalog = await listLLMModels();
  return catalog.data.map(model => ({ id: model.id, ownedBy: model.owned_by }));
}
