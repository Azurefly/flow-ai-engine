import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import mysql from "mysql2/promise";
import { approvalRequirement, normalizeReferenceOperateConfig, type TemporaryRoleChange } from "../shared/reference-operate-config";
import { normalizeReferenceRouterConfig, type NormalizedRouterRule } from "../shared/reference-router-config";
import { invokeLLM, listLLMModels } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import { resolveAutoRelatedParticipantUserIds, resolveOperateAssignees, resolveWorkflowUserRoleKeys } from "./organization-service";
import type { Definition } from "./workflow-service";

type JsonRecord = Record<string, unknown>;
type WorkflowUser = { id: number; role: "user" | "admin" };
type WorkflowNode = Definition["nodes"][number];
type WorkflowEdge = Definition["edges"][number];
export type WorkflowRunDetail = { workflowId: string; nodeRuns: mysql.RowDataPacket[]; [key: string]: unknown };
export type RunFilters = { status?: "queued" | "running" | "success" | "failed" | "cancelled"; from?: Date; to?: Date; triggeredByUserId?: number; limit?: number };

const MAX_STEPS = 100;
const MAX_HTTP_RESPONSE_BYTES = 1_000_000;
const HTTP_TIMEOUT_MS = 15_000;

let pool: mysql.Pool | undefined;
function db() {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
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
  const segments = path.trim().replace(/^\$\.?/, "").split(".").filter(Boolean);
  let value: unknown = context;
  for (const segment of segments) {
    if (Array.isArray(value) && /^\d+$/.test(segment)) value = value[Number(segment)];
    else if (value && typeof value === "object") value = (value as JsonRecord)[segment];
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
    return resolved === undefined || resolved === null ? "" : typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });
}

function resolveTemplates(value: unknown, context: JsonRecord): unknown {
  if (Array.isArray(value)) return value.map(item => resolveTemplates(item, context));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as JsonRecord).map(([key, item]) => [key, resolveTemplates(item, context)]));
  return interpolate(value, context);
}

function blockedIp(address: string) {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.") || normalized.startsWith("::ffff:169.254.");
}

export async function assertSafeHttpUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("HTTP 节点 URL 无效。");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP 节点仅支持 http 或 https 协议。");
  if (url.username || url.password) throw new Error("HTTP 节点 URL 不允许包含凭据。");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("HTTP 节点仅允许 80 或 443 端口。");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("HTTP 节点拒绝本机地址。");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => blockedIp(item.address))) throw new Error("HTTP 节点拒绝私有、环回、链路本地或保留网络地址。");
  return url;
}

async function executeHttpNode(config: JsonRecord, context: JsonRecord) {
  const resolved = asRecord(resolveTemplates(config, context));
  const url = await assertSafeHttpUrl(String(resolved.url ?? ""));
  const query = asRecord(resolved.query);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const method = String(resolved.method ?? "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("HTTP 节点请求方法不受支持。");
  const headers = asRecord(resolved.headers);
  const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => !["host", "connection", "content-length"].includes(key.toLowerCase())).map(([key, value]) => [key, String(value)]));
  const body = resolved.body;
  const serializedBody = body === undefined || body === null ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  if (serializedBody && !Object.keys(safeHeaders).some(key => key.toLowerCase() === "content-type")) safeHeaders["content-type"] = "application/json";
  const controller = new AbortController();
  const configuredTimeout = typeof resolved.timeout === "number" && Number.isFinite(resolved.timeout) ? resolved.timeout : HTTP_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(Math.floor(configuredTimeout), 1_000), HTTP_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, headers: safeHeaders, body: ["GET", "DELETE"].includes(method) ? undefined : serializedBody, redirect: "error", signal: controller.signal });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_RESPONSE_BYTES) throw new Error("HTTP 节点响应超过 1MB 限制。");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_HTTP_RESPONSE_BYTES) throw new Error("HTTP 节点响应超过 1MB 限制。");
    const text = new TextDecoder().decode(bytes);
    const contentType = response.headers.get("content-type") ?? "";
    let parsedBody: unknown = text;
    if (contentType.includes("application/json")) {
      try { parsedBody = JSON.parse(text); } catch { /* preserve malformed body as text */ }
    }
    if (!response.ok) throw new Error(`HTTP 节点请求失败：${response.status} ${response.statusText}`);
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: parsedBody };
  } finally {
    clearTimeout(timeout);
  }
}

function firstConfiguredString(...values: unknown[]) {
  return values.find(value => typeof value === "string" && value.trim()) as string | undefined;
}

function keyValueEntries(value: unknown) {
  if (!Array.isArray(value)) return asRecord(value);
  return Object.fromEntries(value.map(item => asRecord(item)).filter(item => typeof item.key === "string" && item.key.trim()).map(item => [String(item.key), item.value]));
}

function parseReferenceBody(value: unknown) {
  if (typeof value !== "string") return value;
  if (!value.trim()) return undefined;
  try { return JSON.parse(value); } catch { return value; }
}

/** Converts the original REST/METHOD persistence shape without dropping legacy keys or weakening HTTP guards. */
export function normalizeReferenceHttpConfig(config: JsonRecord): JsonRecord {
  const method = String(firstConfiguredString(config.restType, config.method) ?? "GET").toUpperCase();
  const attributes = asRecord(config.restAttributeMap);
  const query = {
    ...keyValueEntries(config.restGetBodyParam),
    ...asRecord(attributes.restEntryParam),
  };
  return {
    url: firstConfiguredString(config.restApi, config.endpoint, config.url) ?? "",
    method,
    headers: keyValueEntries(config.restHeaderParam ?? config.headers),
    body: parseReferenceBody(config.restJsonParam === undefined || config.restJsonParam === "" ? config.body : config.restJsonParam),
    query,
    timeout: config.timeout,
  };
}

async function executeLlmNode(config: JsonRecord, context: JsonRecord) {
  const resolved = asRecord(resolveTemplates(config, context));
  const catalog = await listLLMModels();
  const requestedModel = typeof resolved.model === "string" ? resolved.model : undefined;
  const model = requestedModel && catalog.data.some(item => item.id === requestedModel) ? requestedModel : catalog.data[0]?.id;
  const systemPrompt = String(resolved.systemPrompt ?? "你是一名严谨的工作流助手。");
  const prompt = String(resolved.prompt ?? resolved.userPrompt ?? "");
  if (!prompt.trim()) throw new Error("LLM 节点必须配置提示词。");
  const maxTokens = typeof resolved.maxTokens === "number" ? Math.min(Math.max(Math.floor(resolved.maxTokens), 64), 8192) : undefined;
  const response = await invokeLLM({ model, maxTokens, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }] });
  const content = response.choices[0]?.message.content;
  return { model: response.model || model, content: Array.isArray(content) ? content.map(part => "text" in part ? part.text : JSON.stringify(part)).join("\n") : content ?? "", usage: response.usage ?? null };
}

function compareCondition(left: unknown, operator: string, right: unknown) {
  switch (operator) {
    case "equals": return left === right;
    case "notEquals": return left !== right;
    case "contains": return typeof left === "string" ? left.includes(String(right ?? "")) : Array.isArray(left) ? left.includes(right) : false;
    case "exists": return left !== undefined && left !== null && left !== "";
    case "greaterThan": return Number(left) > Number(right);
    case "lessThan": return Number(left) < Number(right);
    default: throw new Error(`条件节点不支持操作符：${operator}`);
  }
}

function routerRuleMatches(rule: NormalizedRouterRule, context: JsonRecord, roleKeys: string[]) {
  if (rule.hasUnsafeCode) throw new Error("路由规则包含原版任意代码，必须迁移为安全条件后才能运行。");
  const hasRoleFilter = rule.roleKeys.length > 0;
  const roleMatched = !hasRoleFilter || rule.roleKeys.some(role => roleKeys.includes(role));
  const hasConditions = rule.conditions.length > 0;
  const conditionsMatched = !hasConditions || rule.conditions.every(condition =>
    compareCondition(interpolate(condition.left, context), condition.operator, interpolate(condition.right, context)),
  );
  if (rule.relation === "or" && (hasRoleFilter || hasConditions)) {
    return (hasRoleFilter && roleMatched) || (hasConditions && conditionsMatched);
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
  roleKeysByUser: Map<number, string[]> = new Map(),
) {
  const resolved = asRecord(resolveTemplates(config, context));
  const normalized = normalizeReferenceRouterConfig(resolved);
  const participants = Array.from(new Set(participantUserIds.filter(id => Number.isInteger(id) && id > 0)));
  const assignments = new Map<string, { handle: string; targetNodeId: string; userIds: number[] }>();
  const addAssignment = (rule: Pick<NormalizedRouterRule, "handle" | "targetNodeId">, userId: number) => {
    const key = `${rule.handle}\u0000${rule.targetNodeId}`;
    const current = assignments.get(key) ?? { handle: rule.handle, targetNodeId: rule.targetNodeId, userIds: [] };
    if (!current.userIds.includes(userId)) current.userIds.push(userId);
    assignments.set(key, current);
  };

  if (participants.length) {
    const ordinaryRules = normalized.rules.filter(rule => !rule.isDefault);
    const defaultRule = normalized.rules.find(rule => rule.isDefault);
    for (const userId of participants) {
      const roles = Array.from(new Set(["default", ...(roleKeysByUser.get(userId) ?? [])]));
      let matched = false;
      for (const rule of ordinaryRules) {
        if (!routerRuleMatches(rule, context, roles)) continue;
        matched = true;
        addAssignment(rule, userId);
        if (!normalized.broadcast) break;
      }
      if (!matched) {
        const fallback = defaultRule ?? { handle: String(interpolate(normalized.defaultRoute, context)), targetNodeId: "" };
        addAssignment(fallback, userId);
      }
    }
  } else {
    // 保持无人员数据流和既有控制流定义的兼容行为。
    const matched = normalized.rules.find(rule => !rule.isDefault && routerRuleMatches(rule, context, ["default"]));
    const fallback = normalized.rules.find(rule => rule.isDefault) ?? { handle: String(interpolate(normalized.defaultRoute, context)), targetNodeId: "" };
    const selected = matched ?? fallback;
    assignments.set(`${selected.handle}\u0000${selected.targetNodeId}`, { handle: selected.handle, targetNodeId: selected.targetNodeId, userIds: [] });
  }

  const selectedBranches = Array.from(assignments.values());
  return {
    broadcast: normalized.broadcast,
    rules: normalized.rules,
    selectedBranches,
    selectedRoutes: Array.from(new Set(selectedBranches.map(branch => branch.handle))),
    selectedRoute: selectedBranches[0]?.handle ?? normalized.defaultRoute,
  };
}

/** 兼容旧调用方的单一路由返回结构。 */
export function selectRouterRoute(config: JsonRecord, context: JsonRecord) {
  return selectRouterRoutes(config, context);
}

async function executeInlineDefinition(definition: Definition, input: JsonRecord) {
  const context: JsonRecord = { input, vars: {}, nodes: {} };
  const nodes = new Map(definition.nodes.map(node => [node.id, node]));
  const startNode = definition.nodes.find(node => node.type === "start");
  if (!startNode) throw new Error("子流程缺少开始节点。");
  const queue = [startNode.id];
  const executed = new Set<string>();
  let finalOutput: unknown = null;
  while (queue.length) {
    if (executed.size >= MAX_STEPS) throw new Error("子流程执行超过最大节点步数。");
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
    definition.edges.filter(edge => edge.sourceNodeId === node.id && (!result.route || (edge.sourceHandle ?? "default") === result.route)).forEach(edge => queue.push(edge.targetNodeId));
  }
  return { output: finalOutput, context };
}

async function executeSubflowNode(config: JsonRecord, context: JsonRecord, ownerUserId: number) {
  const resolved = asRecord(resolveTemplates(config, context));
  const subflowId = String(resolved.subflowId ?? "").trim();
  if (!subflowId) throw new Error("子流程节点缺少子流程标识。");
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT id,name,definitionJson,isEnabled FROM workflow_subflow WHERE id=? AND ownerUserId=? LIMIT 1", [subflowId, ownerUserId]);
  const subflow = rows[0];
  if (!subflow || !subflow.isEnabled) throw new Error("引用的子流程不存在或已停用。");
  const definition = readJson(subflow.definitionJson) as Definition;
  if (!definition?.nodes?.length) throw new Error("引用的子流程定义为空。");
  const input = asRecord(resolved.input ?? context.input);
  const result = await executeInlineDefinition(definition, input);
  return { subflowId, subflowName: subflow.name, result: result.output };
}

async function executeNode(node: WorkflowNode, context: JsonRecord, allowSubflow = true, subflowOwnerUserId?: number) {
  const config = asRecord(node.config);
  switch (node.type) {
    case "start": return { output: asRecord(resolveTemplates(asRecord(config.initialVariables), context)) };
    case "state": return { output: { stateCode: String(resolveTemplates(firstConfiguredString(config.nodeDh, config.stateCode) ?? "STATE", context)), displayName: String(resolveTemplates(firstConfiguredString(config.jdmc, config.displayName) ?? node.name, context)), stateType: String(resolveTemplates(config.stateType ?? "business", context)), stateColor: resolveTemplates(config.stateColor, context), flowStatus: resolveTemplates(config.flowStatus, context) } };
    case "form": return { output: { fields: resolveTemplates(Array.isArray(config.fields) ? config.fields : [], context), submitted: asRecord(context.input) } };
    case "router": {
      const runtime = asRecord(context.runtime);
      const participantUserIds = Array.isArray(runtime.currentNodeParticipantUserIds) ? runtime.currentNodeParticipantUserIds.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
      const roleKeysByUser = new Map<number, string[]>();
      const configuredRoles = asRecord(runtime.roleKeysByUser);
      for (const userId of participantUserIds) {
        const keys = Array.isArray(configuredRoles[String(userId)]) ? configuredRoles[String(userId)] as unknown[] : [];
        roleKeysByUser.set(userId, keys.map(String));
      }
      const result = selectRouterRoutes(config, context, participantUserIds, roleKeysByUser);
      return { output: result, route: result.selectedRoute, routeTargets: result.selectedBranches };
    }
    case "rest":
    case "method": return { output: await executeHttpNode(normalizeReferenceHttpConfig(config), context) };
    case "operate": throw new Error("操作节点需要 P1 人工任务工作台；当前运行已安全阻断，未执行任何外部操作。");
    case "sql": throw new Error("SQL 节点需要 P2 数据源与查询策略；当前运行已安全阻断，未执行任何数据库语句。");
    case "transform": return { output: asRecord(resolveTemplates(asRecord(config.mappings ?? config.output), context)) };
    case "condition": {
      const left = interpolate(config.left, context);
      const right = interpolate(config.right, context);
      const matched = compareCondition(left, String(config.operator ?? "equals"), right);
      return { output: { matched, left, right }, route: matched ? String(config.trueHandle ?? "true") : String(config.falseHandle ?? "false") };
    }
    case "http": return { output: await executeHttpNode(config, context) };
    case "llm": return { output: await executeLlmNode(config, context) };
    case "subflow": {
      if (!allowSubflow) throw new Error("子流程不允许嵌套调用。");
      if (!subflowOwnerUserId) throw new Error("子流程缺少流程所有者上下文。");
      return { output: await executeSubflowNode(config, context, subflowOwnerUserId) };
    }
    case "end": return { output: { result: resolveTemplates(config.resultTemplate ?? "{{vars}}", context) } };
    default: throw new Error(`不支持的节点类型：${node.type}`);
  }
}

async function insertNodeRun(runId: string, node: WorkflowNode, input: JsonRecord) {
  const nodeRunId = randomUUID();
  await db().query("INSERT INTO workflow_node_run (id,runId,nodeId,nodeType,nodeName,status,inputJson,startedAt) VALUES (?,?,?,?,?,'running',?,NOW())", [nodeRunId, runId, node.id, node.type, node.name, JSON.stringify(input)]);
  return nodeRunId;
}

async function finishNodeRun(nodeRunId: string, status: "success" | "failed" | "waiting" | "skipped", startedAt: number, output?: unknown, error?: unknown) {
  await db().query("UPDATE workflow_node_run SET status=?,outputJson=?,errorJson=?,finishedAt=NOW(),durationMs=? WHERE id=?", [status, output === undefined ? null : JSON.stringify(output), error === undefined ? null : JSON.stringify(error), Date.now() - startedAt, nodeRunId]);
}

async function createFailureAlerts(input: { workflowId: string; workflowName: string; runId: string; ownerUserId: number; triggeredByUserId: number; details: JsonRecord }) {
  const recipients = Array.from(new Set([input.ownerUserId, input.triggeredByUserId]));
  if (recipients.length) {
    await db().query(
      "INSERT INTO workflow_run_alert (id,workflowId,runId,recipientUserId,severity,summary,detailsJson) VALUES ?",
      [recipients.map(recipientUserId => [randomUUID(), input.workflowId, input.runId, recipientUserId, "critical", `流程“${input.workflowName}”运行失败`, JSON.stringify(input.details)])],
    );
  }
  await notifyOwner({ title: "Flow AI Engine 运行失败", content: `流程：${input.workflowName}\n运行：${input.runId}\n原因：${String(input.details.message ?? "未知错误")}` }).catch(() => false);
}

export async function executeWorkflow(input: { workflowId: string; triggeredBy: WorkflowUser; workflowInput?: JsonRecord }) {
  const [workflowRows] = await db().query<mysql.RowDataPacket[]>("SELECT id,ownerUserId,name,projectId,status,auditStatus,definitionJson FROM workflow WHERE id=? LIMIT 1", [input.workflowId]);
  const workflow = workflowRows[0] as PersistedWorkflow | undefined;
  if (!workflow) throw new Error("流程不存在。");
  if (workflow.projectId && (workflow.status !== "published" || workflow.auditStatus !== "approved")) throw new Error("项目流程尚未发布或未通过审核，无法发起运行。");
  const definition = readJson(workflow.definitionJson) as Definition;
  if (!definition?.nodes?.length) throw new Error("流程定义为空。");
  // 对持久化快照再次做可执行校验，防止历史草稿或直接写库绕过发布时的字段约束。
  const executableDefinition = (await import("./workflow-service")).validate(definition, true);

  const runId = randomUUID();
  const context: JsonRecord = {
    input: input.workflowInput ?? {},
    vars: {},
    nodes: {},
    runtime: {
      triggeredByUserId: input.triggeredBy.id,
      lastActorUserId: input.triggeredBy.id,
      participantUserIds: [input.triggeredBy.id],
      roleKeysByUser: { [String(input.triggeredBy.id)]: ["default", "initiator", "sender"] },
    },
  };
  const authorizationSnapshot = { userId: input.triggeredBy.id, userRole: input.triggeredBy.role, permission: "workflow:run", authorizedAt: new Date().toISOString() };
  await db().query(
    "INSERT INTO workflow_run (id,workflowId,ownerUserId,triggeredByUserId,triggerType,status,definitionSnapshotJson,inputJson,contextJson,authorizationSnapshotJson,startedAt) VALUES (?,?,?,?,?,'running',?,?,?,?,NOW())",
    [runId, input.workflowId, workflow.ownerUserId, input.triggeredBy.id, "manual", JSON.stringify(executableDefinition), JSON.stringify(input.workflowInput ?? {}), JSON.stringify(context), JSON.stringify(authorizationSnapshot)],
  );

  const startNode = executableDefinition.nodes.find(node => node.type === "start");
  if (!startNode) throw new Error("流程缺少开始节点。");
  setRuntimeNodeParticipants(context, startNode.id, [input.triggeredBy.id]);
  const runStartedAt = Date.now();
  try {
    const segment = await executeRunSegment({ runId, workflow, definition: executableDefinition, context, queue: [startNode.id] });
    if (segment.status === "waiting") return { runId, status: "waiting" as const, taskId: segment.taskId };
    await db().query("UPDATE workflow_run SET status='success',contextJson=?,finalOutputJson=?,finishedAt=NOW(),durationMs=? WHERE id=?", [JSON.stringify(context), JSON.stringify(segment.output), Date.now() - runStartedAt, runId]);
    return { runId, status: "success" as const, output: segment.output };
  } catch (error) {
    const details = { message: error instanceof Error ? error.message : String(error) };
    await db().query("UPDATE workflow_run SET status='failed',contextJson=?,errorJson=?,finishedAt=NOW(),durationMs=? WHERE id=?", [JSON.stringify(context), JSON.stringify(details), Date.now() - runStartedAt, runId]);
    try {
      await createFailureAlerts({ workflowId: input.workflowId, workflowName: String(workflow.name), runId, ownerUserId: Number(workflow.ownerUserId), triggeredByUserId: input.triggeredBy.id, details });
    } catch (alertError) {
      console.error("[Workflow] Failed to persist run alert", alertError);
    }
    throw error;
  }
}

type PersistedWorkflow = mysql.RowDataPacket & { id: string; ownerUserId: number; projectId?: string | null; name: string };
type RunSegmentResult = { status: "success"; output: unknown } | { status: "waiting"; taskId: string };

function runtimeUserIds(context: JsonRecord) {
  const runtime = asRecord(context.runtime);
  const values = Array.isArray(runtime.participantUserIds) ? runtime.participantUserIds : [];
  return Array.from(new Set(values.map(Number).filter(id => Number.isInteger(id) && id > 0)));
}

function addRuntimeParticipants(context: JsonRecord, userIds: number[]) {
  const runtime = asRecord(context.runtime);
  runtime.participantUserIds = Array.from(new Set([...runtimeUserIds(context), ...userIds.filter(id => Number.isInteger(id) && id > 0)]));
  context.runtime = runtime;
}

function setRuntimeReceivers(context: JsonRecord, userIds: number[]) {
  const runtime = asRecord(context.runtime);
  runtime.receiverUserIds = Array.from(new Set(userIds.filter(id => Number.isInteger(id) && id > 0)));
  context.runtime = runtime;
}

function runtimeNodeParticipants(context: JsonRecord, nodeId: string) {
  const runtime = asRecord(context.runtime);
  const byNode = asRecord(runtime.nodeParticipantUserIds);
  const values = Array.isArray(byNode[nodeId]) ? byNode[nodeId] as unknown[] : [];
  return Array.from(new Set(values.map(Number).filter(id => Number.isInteger(id) && id > 0)));
}

function setRuntimeNodeParticipants(context: JsonRecord, nodeId: string, userIds: number[]) {
  const runtime = asRecord(context.runtime);
  const byNode = asRecord(runtime.nodeParticipantUserIds);
  byNode[nodeId] = Array.from(new Set(userIds.filter(id => Number.isInteger(id) && id > 0)));
  runtime.nodeParticipantUserIds = byNode;
  context.runtime = runtime;
}

function setCurrentNodeParticipants(context: JsonRecord, userIds: number[]) {
  const runtime = asRecord(context.runtime);
  runtime.currentNodeParticipantUserIds = Array.from(new Set(userIds.filter(id => Number.isInteger(id) && id > 0)));
  context.runtime = runtime;
}

function runtimeRoleKeys(context: JsonRecord, userId: number) {
  const runtime = asRecord(context.runtime);
  const rolesByUser = asRecord(runtime.roleKeysByUser);
  const configured = Array.isArray(rolesByUser[String(userId)]) ? rolesByUser[String(userId)] as unknown[] : [];
  return Array.from(new Set(["default", ...configured.map(String).filter(Boolean)]));
}

function updateRuntimeRoles(context: JsonRecord, userIds: number[], changes: TemporaryRoleChange[], contextualRole?: string) {
  const runtime = asRecord(context.runtime);
  const rolesByUser = asRecord(runtime.roleKeysByUser);
  for (const userId of userIds.filter(id => Number.isInteger(id) && id > 0)) {
    const current = new Set(runtimeRoleKeys(context, userId));
    if (contextualRole) current.add(contextualRole);
    for (const change of changes) for (const roleKey of change.roleKeys) change.action === "add" ? current.add(roleKey) : current.delete(roleKey);
    rolesByUser[String(userId)] = Array.from(current);
  }
  runtime.roleKeysByUser = rolesByUser;
  context.runtime = runtime;
}

function configuredRoleKeys(value: unknown) {
  const items = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  return Array.from(new Set(items.map(item => {
    if (typeof item === "string" || typeof item === "number") return String(item).trim();
    const record = asRecord(item);
    return String(record.roleCode ?? record.roleKey ?? record.code ?? record.id ?? record.key ?? record.value ?? "").trim();
  }).filter(Boolean)));
}

function shouldAutomaticallyExecute(config: JsonRecord, context: JsonRecord) {
  const normalized = normalizeReferenceOperateConfig(config);
  if (!normalized.autoExecute) return false;
  if (normalized.hasUnsafeAutoExecuteCode) throw new Error("操作节点包含原版自动执行代码，必须迁移为安全条件后才能运行。");
  if (!normalized.autoExecuteConditions.length) return true;
  return normalized.autoExecuteConditions.every(item => {
    const condition = asRecord(item);
    if (condition.left === undefined || condition.operator === undefined) throw new Error("操作节点自动执行条件无法安全解释，请配置左值、操作符和右值。");
    return compareCondition(interpolate(condition.left, context), String(condition.operator), interpolate(condition.right, context));
  });
}

async function upsertParticipantState(input: { runId: string; workflowId: string; userId: number; roleKey?: string; stateCode?: string; stateName: string; flowStatus?: string; stateColor?: string; sourceNodeId?: string; availableOperations?: unknown[] }) {
  await db().query(
    "INSERT INTO workflow_participant_state (id,runId,workflowId,userId,roleKey,stateCode,stateName,flowStatus,stateColor,sourceNodeId,availableOperationsJson) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE stateCode=VALUES(stateCode),stateName=VALUES(stateName),flowStatus=VALUES(flowStatus),stateColor=VALUES(stateColor),sourceNodeId=VALUES(sourceNodeId),availableOperationsJson=VALUES(availableOperationsJson),updatedAt=NOW()",
    [randomUUID(), input.runId, input.workflowId, input.userId, input.roleKey ?? "default", input.stateCode ?? null, input.stateName, input.flowStatus ?? input.stateName, input.stateColor ?? null, input.sourceNodeId ?? null, JSON.stringify(input.availableOperations ?? [])],
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
    if (record.bj) operations.push({ code: "bj", name: "办结", type: "innate" });
    if (record.cs) operations.push({ code: "cs", name: "抄送", type: "innate" });
    if (record.ch) operations.push({ code: "ch", name: "撤回", type: "innate" });
  }
  return operations;
}

async function persistStateNode(input: { runId: string; workflowId: string; node: WorkflowNode; context: JsonRecord }) {
  const config = asRecord(resolveTemplates(input.node.config, input.context));
  const runtime = asRecord(input.context.runtime);
  const initiatorUserId = Number(runtime.triggeredByUserId);
  const actorUserId = Number(runtime.lastActorUserId || runtime.triggeredByUserId);
  const stateCode = String(firstConfiguredString(config.nodeDh, config.stateCode) ?? input.node.id);
  const stateName = String(firstConfiguredString(config.jdmc, config.displayName) ?? input.node.name);
  const flowStatus = String(firstConfiguredString(config.flowStatus) ?? stateName);
  const stateColor = firstConfiguredString(config.stateColor);

  const currentParticipants = runtimeNodeParticipants(input.context, input.node.id);
  const participantUserIds = Array.from(new Set([...currentParticipants, initiatorUserId, actorUserId].filter(id => Number.isInteger(id) && id > 0)));
  const iamRoles = await resolveWorkflowUserRoleKeys(participantUserIds, input.workflowId);
  const boundRoles = configuredRoleKeys(config.bdjs);
  const availableOperations = stateConfiguredOperations(config);
  for (const userId of participantUserIds) {
    const roles = Array.from(new Set([...(iamRoles.get(userId) ?? ["default"]), ...runtimeRoleKeys(input.context, userId)]));
    const stateRoles = boundRoles.length ? roles.filter(role => boundRoles.includes(role)) : ["default"];
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

async function executeRunSegment(input: { runId: string; workflow: PersistedWorkflow; definition: Definition; context: JsonRecord; queue: string[]; finalOutput?: unknown }): Promise<RunSegmentResult> {
  const nodes = new Map(input.definition.nodes.map(node => [node.id, node]));
  const executed = new Set<string>();
  let finalOutput = input.finalOutput ?? null;
  while (input.queue.length) {
    if (executed.size >= MAX_STEPS) throw new Error("流程执行超过最大节点步数，可能存在循环。");
    const nodeId = input.queue.shift()!;
    if (executed.has(nodeId)) continue;
    const node = nodes.get(nodeId);
    if (!node) throw new Error(`流程引用了不存在的节点：${nodeId}`);
    executed.add(nodeId);
    const currentParticipants = runtimeNodeParticipants(input.context, node.id);
    setCurrentNodeParticipants(input.context, currentParticipants.length ? currentParticipants : runtimeUserIds(input.context));
    const nodeInput = { context: JSON.parse(JSON.stringify(input.context)), config: node.config };
    const nodeRunId = await insertNodeRun(input.runId, node, nodeInput);
    const startedAt = Date.now();
    try {
      if (node.type === "operate") {
        const config = asRecord(resolveTemplates(node.config, input.context));
        const runtime = asRecord(input.context.runtime);
        const reference = normalizeReferenceOperateConfig(config);
        const senderUserId = Number(runtime.lastActorUserId || runtime.triggeredByUserId);
        updateRuntimeRoles(input.context, [senderUserId], reference.senderTemporaryRoles, "sender");
        const relatedParticipants = await resolveAutoRelatedParticipantUserIds(config, input.context);
        addRuntimeParticipants(input.context, relatedParticipants);
        if (relatedParticipants.length) {
          setRuntimeReceivers(input.context, relatedParticipants);
          updateRuntimeRoles(input.context, relatedParticipants, reference.receiverTemporaryRoles, "receiver");
        }

        if (shouldAutomaticallyExecute(config, input.context)) {
          const completedByUserId = Number(runtime.lastActorUserId || runtime.triggeredByUserId);
          const automaticOutput = { automatic: true, completedByUserId, operationName: String(firstConfiguredString(config.czmc, config.instruction) ?? node.name), relatedParticipantUserIds: relatedParticipants };
          const vars = asRecord(input.context.vars);
          const nodeOutputs = asRecord(input.context.nodes);
          vars[node.id] = automaticOutput;
          nodeOutputs[node.id] = automaticOutput;
          input.context.vars = vars;
          input.context.nodes = nodeOutputs;
          await finishNodeRun(nodeRunId, "success", startedAt, automaticOutput);
          const automaticParticipants = Array.from(new Set([...currentParticipants, ...relatedParticipants]));
          input.definition.edges.filter(edge => edge.sourceNodeId === node.id).forEach(edge => {
            setRuntimeNodeParticipants(input.context, edge.targetNodeId, automaticParticipants);
            input.queue.push(edge.targetNodeId);
          });
          continue;
        }

        const assignment = await resolveOperateAssignees({ config, context: input.context, workflowId: input.workflow.id });
        let approverUserIds = assignment.candidateUserIds;
        if (reference.signMode !== "single" && reference.signSelectorUserIds.length) {
          approverUserIds = approverUserIds.filter(userId => reference.signSelectorUserIds.includes(userId));
          if (!approverUserIds.length) throw new Error("或签/会签指定方未命中当前操作候选人。");
        }
        if (reference.signMode !== "single" && !approverUserIds.length) throw new Error("或签/会签必须解析到至少一名审批人。");
        setRuntimeReceivers(input.context, approverUserIds);
        updateRuntimeRoles(input.context, approverUserIds, reference.receiverTemporaryRoles, "receiver");
        const nextNodeIds = input.definition.edges.filter(edge => edge.sourceNodeId === node.id).map(edge => edge.targetNodeId);
        const operationName = String(firstConfiguredString(config.czmc, config.instruction, config.description) ?? node.name);
        const pendingStatusName = String(firstConfiguredString(config.pendingStatusName) ?? "待审批");
        const taskRoleKey = assignment.mode === "role" ? String(config.assigneeRoleCode || "default") : "default";
        const approvalGroupId = reference.signMode === "single" ? null : randomUUID();
        if (approvalGroupId) {
          const requiredApprovals = approvalRequirement(reference.signMode, approverUserIds.length, reference.passPercent);
          await db().query(
            "INSERT INTO workflow_task_group (id,workflowId,runId,nodeId,signMode,totalApprovers,requiredApprovals,passPercentBasisPoints,nextNodeIdsJson) VALUES (?,?,?,?,?,?,?,?,?)",
            [approvalGroupId, input.workflow.id, input.runId, node.id, reference.signMode, approverUserIds.length, requiredApprovals, Math.round(reference.passPercent * 10000), JSON.stringify(nextNodeIds)],
          );
        }
        const taskAssignments = approvalGroupId ? approverUserIds.map(userId => ({ assignedUserId: userId, candidateUserIds: [userId] })) : [{ assignedUserId: assignment.assignedUserId, candidateUserIds: approverUserIds }];
        const taskIds: string[] = [];
        for (const taskAssignment of taskAssignments) {
          const taskId = randomUUID();
          taskIds.push(taskId);
          await db().query(
            "INSERT INTO workflow_task (id,workflowId,projectId,runId,nodeId,nodeName,assignedUserId,candidateUserIdsJson,approvalGroupId,signMode,roleKey,operationName,pendingStatusName,instruction,payloadJson,nextNodeIdsJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [taskId, input.workflow.id, input.workflow.projectId ?? null, input.runId, node.id, node.name, taskAssignment.assignedUserId, taskAssignment.candidateUserIds.length ? JSON.stringify(taskAssignment.candidateUserIds) : null, approvalGroupId, reference.signMode, taskRoleKey, operationName, pendingStatusName, String(firstConfiguredString(config.instruction) ?? operationName), JSON.stringify({ config, context: input.context, assignmentMode: assignment.mode, reference }), JSON.stringify(nextNodeIds)],
          );
          for (const userId of taskAssignment.candidateUserIds) {
            const availableOperation = { taskId, name: operationName, ...(reference.signMode === "single" ? {} : { signMode: reference.signMode }) };
            await upsertParticipantState({ runId: input.runId, workflowId: input.workflow.id, userId, roleKey: taskRoleKey, stateCode: node.id, stateName: pendingStatusName, flowStatus: pendingStatusName, sourceNodeId: node.id, availableOperations: [availableOperation] });
          }
        }
        addRuntimeParticipants(input.context, approverUserIds);
        await finishNodeRun(nodeRunId, "waiting", startedAt, { taskId: taskIds[0], taskIds, approvalGroupId, signMode: reference.signMode, status: "pending", assignedUserId: assignment.assignedUserId, candidateUserIds: approverUserIds, operationName });
        await db().query("UPDATE workflow_run SET status='running',contextJson=? WHERE id=?", [JSON.stringify(input.context), input.runId]);
        return { status: "waiting", taskId: taskIds[0] };
      }
      if (node.type === "router") {
        const routeParticipants = runtimeNodeParticipants(input.context, node.id);
        const iamRoles = await resolveWorkflowUserRoleKeys(routeParticipants, input.workflow.id);
        const runtime = asRecord(input.context.runtime);
        const rolesByUser = asRecord(runtime.roleKeysByUser);
        for (const userId of routeParticipants) {
          rolesByUser[String(userId)] = Array.from(new Set([...(Array.isArray(rolesByUser[String(userId)]) ? rolesByUser[String(userId)] as unknown[] : []), ...(iamRoles.get(userId) ?? [])]));
        }
        runtime.roleKeysByUser = rolesByUser;
        input.context.runtime = runtime;
      }
      const result = await executeNode(node, input.context, true, Number(input.workflow.ownerUserId));
      const vars = asRecord(input.context.vars);
      const nodeOutputs = asRecord(input.context.nodes);
      vars[node.id] = result.output;
      nodeOutputs[node.id] = result.output;
      input.context.vars = vars;
      input.context.nodes = nodeOutputs;
      if (node.type === "start") Object.assign(vars, asRecord(result.output));
      if (node.type === "state") await persistStateNode({ runId: input.runId, workflowId: input.workflow.id, node, context: input.context });
      if (node.type === "end") finalOutput = result.output;
      await finishNodeRun(nodeRunId, "success", startedAt, result.output);
      const routed = result as { route?: string; routeTargets?: unknown[] };
      const routeTargets = Array.isArray(routed.routeTargets) ? routed.routeTargets.map(asRecord) : [];
      if (node.type === "router" && routeTargets.length) {
        for (const branch of routeTargets) {
          const handle = String(branch.handle ?? routed.route ?? "default");
          const targetNodeId = String(branch.targetNodeId ?? "");
          const branchUsers = Array.isArray(branch.userIds) ? branch.userIds.map(Number).filter(id => Number.isInteger(id) && id > 0) : currentParticipants;
          const edges = input.definition.edges.filter(edge => edge.sourceNodeId === node.id && ((targetNodeId && edge.targetNodeId === targetNodeId) || (!targetNodeId && (edge.sourceHandle ?? "default") === handle) || (edge.sourceHandle ?? "default") === handle));
          for (const edge of edges) {
            setRuntimeNodeParticipants(input.context, edge.targetNodeId, branchUsers);
            input.queue.push(edge.targetNodeId);
          }
        }
      } else {
        input.definition.edges.filter(edge => edge.sourceNodeId === node.id && (!routed.route || (edge.sourceHandle ?? "default") === routed.route)).forEach(edge => {
          setRuntimeNodeParticipants(input.context, edge.targetNodeId, currentParticipants);
          input.queue.push(edge.targetNodeId);
        });
      }
    } catch (error) {
      const details = { message: error instanceof Error ? error.message : String(error) };
      await finishNodeRun(nodeRunId, "failed", startedAt, undefined, details);
      throw error;
    }
  }
  return { status: "success", output: finalOutput };
}

type ApprovalGateResult = {
  continueFlow: boolean;
  completedApprovals: number;
  requiredApprovals: number;
  totalApprovers: number;
  affectedUserIds: number[];
  pendingTaskId?: string;
  groupResults?: unknown[];
};

async function completeTaskAndEvaluateApprovalGroup(task: mysql.RowDataPacket, input: { taskId: string; completedBy: WorkflowUser; result: JsonRecord }): Promise<ApprovalGateResult> {
  if (!task.approvalGroupId) {
    const [claim] = await db().query<mysql.ResultSetHeader>(
      "UPDATE workflow_task SET status='completed',completedByUserId=?,resultJson=?,completedAt=NOW() WHERE id=? AND status='claimed'",
      [input.completedBy.id, JSON.stringify(input.result), input.taskId],
    );
    if (!claim.affectedRows) throw new Error("人工任务已被其他操作处理。 ");
    return { continueFlow: true, completedApprovals: 1, requiredApprovals: 1, totalApprovers: 1, affectedUserIds: [input.completedBy.id], groupResults: [input.result] };
  }

  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [lockedTasks] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM workflow_task WHERE id=? FOR UPDATE", [input.taskId]);
    const lockedTask = lockedTasks[0];
    if (!lockedTask || lockedTask.status !== "claimed" || (Number(lockedTask.claimedByUserId) !== input.completedBy.id && input.completedBy.role !== "admin")) {
      throw new Error("人工任务已被其他操作处理。 ");
    }
    const [groups] = await connection.query<mysql.RowDataPacket[]>("SELECT * FROM workflow_task_group WHERE id=? FOR UPDATE", [task.approvalGroupId]);
    const group = groups[0];
    if (!group || group.status !== "waiting") throw new Error("或签/会签任务组已结束。 ");
    await connection.query(
      "UPDATE workflow_task SET status='completed',completedByUserId=?,resultJson=?,completedAt=NOW() WHERE id=?",
      [input.completedBy.id, JSON.stringify(input.result), input.taskId],
    );
    const [progressRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT SUM(status='completed') AS completedApprovals FROM workflow_task WHERE approvalGroupId=?",
      [task.approvalGroupId],
    );
    const completedApprovals = Number(progressRows[0]?.completedApprovals ?? 0);
    const requiredApprovals = Number(group.requiredApprovals);
    const totalApprovers = Number(group.totalApprovers);
    const [members] = await connection.query<mysql.RowDataPacket[]>("SELECT id,assignedUserId,status,resultJson FROM workflow_task WHERE approvalGroupId=? ORDER BY createdAt,id", [task.approvalGroupId]);
    const affectedUserIds = Array.from(new Set(members.map(row => Number(row.assignedUserId)).filter(id => Number.isInteger(id) && id > 0)));
    if (completedApprovals < requiredApprovals) {
      const pendingTaskId = String(members.find(row => row.status === "pending" || row.status === "claimed")?.id ?? "");
      await connection.commit();
      return { continueFlow: false, completedApprovals, requiredApprovals, totalApprovers, affectedUserIds: [input.completedBy.id], pendingTaskId: pendingTaskId || undefined };
    }
    await connection.query("UPDATE workflow_task_group SET status='completed',completedByTaskId=?,completedAt=NOW() WHERE id=? AND status='waiting'", [input.taskId, task.approvalGroupId]);
    await connection.query("UPDATE workflow_task SET status='cancelled' WHERE approvalGroupId=? AND status IN ('pending','claimed')", [task.approvalGroupId]);
    await connection.commit();
    return {
      continueFlow: true,
      completedApprovals,
      requiredApprovals,
      totalApprovers,
      affectedUserIds,
      groupResults: members.filter(row => row.status === "completed").map(row => readJson(row.resultJson)),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function resumeWorkflowTask(input: { taskId: string; completedBy: WorkflowUser; result: JsonRecord }) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,r.contextJson,r.definitionSnapshotJson,r.status AS runStatus,r.startedAt,w.ownerUserId,w.name AS workflowName,w.projectId
       FROM workflow_task t JOIN workflow_run r ON r.id=t.runId JOIN workflow w ON w.id=t.workflowId WHERE t.id=? LIMIT 1`,
    [input.taskId],
  );
  const task = rows[0] as PersistedWorkflow & mysql.RowDataPacket;
  if (!task) throw new Error("人工任务不存在。 ");
  if (task.status !== "claimed" || (Number(task.claimedByUserId) !== input.completedBy.id && input.completedBy.role !== "admin")) throw new Error("仅领取该任务的处理人可以完成操作。 ");
  if (task.runStatus !== "running") throw new Error("所属流程实例不处于等待人工操作状态。 ");
  const gate = await completeTaskAndEvaluateApprovalGroup(task, input);
  await db().query(
    "UPDATE workflow_participant_state SET stateName='已审核',flowStatus='已审核',availableOperationsJson=?,updatedAt=NOW() WHERE runId=? AND userId=? AND roleKey=?",
    [JSON.stringify([]), task.runId, input.completedBy.id, String(task.roleKey || "default")],
  );
  if (!gate.continueFlow) {
    return {
      runId: String(task.runId),
      status: "waiting" as const,
      taskId: gate.pendingTaskId ?? input.taskId,
      approvalProgress: { completed: gate.completedApprovals, required: gate.requiredApprovals, total: gate.totalApprovers },
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
      "UPDATE workflow_participant_state SET availableOperationsJson=?,updatedAt=NOW() WHERE runId=? AND userId IN (" + placeholders + ")",
      [JSON.stringify([]), task.runId, ...gate.affectedUserIds],
    );
  }
  const definition = readJson(task.definitionSnapshotJson) as Definition;
  const taskOutput = {
    taskId: input.taskId,
    approvalGroupId: task.approvalGroupId ?? null,
    signMode: task.signMode ?? "single",
    completedByUserId: input.completedBy.id,
    operationName: task.operationName ?? task.nodeName,
    result: input.result,
    groupResults: gate.groupResults ?? [input.result],
    approvalProgress: { completed: gate.completedApprovals, required: gate.requiredApprovals, total: gate.totalApprovers },
  };
  const vars = asRecord(context.vars);
  const nodeOutputs = asRecord(context.nodes);
  vars[String(task.nodeId)] = taskOutput;
  nodeOutputs[String(task.nodeId)] = taskOutput;
  context.vars = vars;
  context.nodes = nodeOutputs;
  const [nodeRuns] = await db().query<mysql.RowDataPacket[]>("SELECT id,startedAt FROM workflow_node_run WHERE runId=? AND nodeId=? AND status='waiting' ORDER BY createdAt DESC LIMIT 1", [task.runId, task.nodeId]);
  if (nodeRuns[0]) await finishNodeRun(nodeRuns[0].id, "success", new Date(nodeRuns[0].startedAt ?? Date.now()).getTime(), taskOutput);
  const nextNodeIds = readJson(task.nextNodeIdsJson);
  const runStartedAt = Date.now();
  try {
    const resumedWorkflow = { ...task, id: String(task.workflowId), name: String(task.workflowName) } as PersistedWorkflow;
    const segment = await executeRunSegment({ runId: String(task.runId), workflow: resumedWorkflow, definition, context, queue: Array.isArray(nextNodeIds) ? nextNodeIds.map(String) : [] });
    if (segment.status === "waiting") return { runId: String(task.runId), status: "waiting" as const, taskId: segment.taskId };
    await db().query("UPDATE workflow_run SET status='success',contextJson=?,finalOutputJson=?,finishedAt=NOW(),durationMs=? WHERE id=?", [JSON.stringify(context), JSON.stringify(segment.output), Date.now() - new Date(task.startedAt ?? runStartedAt).getTime(), task.runId]);
    return { runId: String(task.runId), status: "success" as const, output: segment.output };
  } catch (error) {
    const details = { message: error instanceof Error ? error.message : String(error) };
    await db().query("UPDATE workflow_run SET status='failed',contextJson=?,errorJson=?,finishedAt=NOW(),durationMs=? WHERE id=?", [JSON.stringify(context), JSON.stringify(details), Date.now() - new Date(task.startedAt ?? runStartedAt).getTime(), task.runId]);
    await createFailureAlerts({ workflowId: String(task.workflowId), workflowName: String(task.workflowName), runId: String(task.runId), ownerUserId: Number(task.ownerUserId), triggeredByUserId: input.completedBy.id, details }).catch(() => undefined);
    throw error;
  }
}

export async function listWorkflowRuns(workflowId: string, filters: RunFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT r.id,r.workflowId,r.triggeredByUserId,r.triggerType,r.status,r.inputJson,r.finalOutputJson,r.errorJson,r.startedAt,r.finishedAt,r.durationMs,r.createdAt,u.username,u.name AS triggeredByName
       FROM workflow_run r LEFT JOIN users u ON u.id=r.triggeredByUserId
      WHERE r.workflowId=? AND (? IS NULL OR r.status=?) AND (? IS NULL OR r.createdAt>=?) AND (? IS NULL OR r.createdAt<=?) AND (? IS NULL OR r.triggeredByUserId=?)
      ORDER BY r.createdAt DESC LIMIT ?`,
    [workflowId, filters.status ?? null, filters.status ?? null, filters.from ?? null, filters.from ?? null, filters.to ?? null, filters.to ?? null, filters.triggeredByUserId ?? null, filters.triggeredByUserId ?? null, limit],
  );
  return rows;
}

export async function getWorkflowRunMetrics(workflowId: string, filters: Omit<RunFilters, "limit"> = {}) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS totalRuns,COALESCE(SUM(status='success'),0) AS successfulRuns,COALESCE(SUM(status='failed'),0) AS failedRuns,COALESCE(ROUND(AVG(CASE WHEN status IN ('success','failed') THEN durationMs END)),0) AS averageDurationMs,COALESCE(MAX(durationMs),0) AS maxDurationMs
       FROM workflow_run WHERE workflowId=? AND (? IS NULL OR status=?) AND (? IS NULL OR createdAt>=?) AND (? IS NULL OR createdAt<=?) AND (? IS NULL OR triggeredByUserId=?)`,
    [workflowId, filters.status ?? null, filters.status ?? null, filters.from ?? null, filters.from ?? null, filters.to ?? null, filters.to ?? null, filters.triggeredByUserId ?? null, filters.triggeredByUserId ?? null],
  );
  const row = rows[0] ?? {};
  const totalRuns = Number(row.totalRuns ?? 0);
  const failedRuns = Number(row.failedRuns ?? 0);
  return { totalRuns, successfulRuns: Number(row.successfulRuns ?? 0), failedRuns, averageDurationMs: Number(row.averageDurationMs ?? 0), maxDurationMs: Number(row.maxDurationMs ?? 0), failureRate: totalRuns ? Math.round((failedRuns / totalRuns) * 1000) / 10 : 0 };
}

export async function listRunAlerts(user: WorkflowUser) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT a.*,w.name AS workflowName,r.status AS runStatus,r.durationMs,r.finishedAt
       FROM workflow_run_alert a JOIN workflow w ON w.id=a.workflowId JOIN workflow_run r ON r.id=a.runId
      WHERE a.recipientUserId=? ORDER BY a.readAt IS NULL DESC,a.createdAt DESC LIMIT 100`,
    [user.id],
  );
  return rows;
}

export async function markRunAlertRead(alertId: string, user: WorkflowUser) {
  const [result] = await db().query<mysql.ResultSetHeader>("UPDATE workflow_run_alert SET readAt=COALESCE(readAt,NOW()) WHERE id=? AND recipientUserId=?", [alertId, user.id]);
  return Boolean(result.affectedRows);
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunDetail | null> {
  const [runRows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow_run WHERE id=? LIMIT 1", [runId]);
  const run = runRows[0];
  if (!run) return null;
  const [nodeRows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow_node_run WHERE runId=? ORDER BY createdAt ASC", [runId]);
  return { ...run, workflowId: String(run.workflowId), nodeRuns: nodeRows };
}

export async function getRuntimeModels() {
  const catalog = await listLLMModels();
  return catalog.data.map(model => ({ id: model.id, ownedBy: model.owned_by }));
}
