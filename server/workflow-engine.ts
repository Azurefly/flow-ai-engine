import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import mysql from "mysql2/promise";
import { invokeLLM, listLLMModels } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
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
  const method = String(resolved.method ?? "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("HTTP 节点请求方法不受支持。");
  const headers = asRecord(resolved.headers);
  const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => !["host", "connection", "content-length"].includes(key.toLowerCase())).map(([key, value]) => [key, String(value)]));
  const body = resolved.body;
  const serializedBody = body === undefined || body === null ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  if (serializedBody && !Object.keys(safeHeaders).some(key => key.toLowerCase() === "content-type")) safeHeaders["content-type"] = "application/json";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
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

async function finishNodeRun(nodeRunId: string, status: "success" | "failed" | "skipped", startedAt: number, output?: unknown, error?: unknown) {
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
  const [workflowRows] = await db().query<mysql.RowDataPacket[]>("SELECT id,ownerUserId,name,definitionJson FROM workflow WHERE id=? LIMIT 1", [input.workflowId]);
  const workflow = workflowRows[0];
  if (!workflow) throw new Error("流程不存在。");
  const definition = readJson(workflow.definitionJson) as Definition;
  if (!definition?.nodes?.length) throw new Error("流程定义为空。");

  const runId = randomUUID();
  const context: JsonRecord = { input: input.workflowInput ?? {}, vars: {}, nodes: {} };
  const authorizationSnapshot = { userId: input.triggeredBy.id, userRole: input.triggeredBy.role, permission: "workflow:run", authorizedAt: new Date().toISOString() };
  await db().query(
    "INSERT INTO workflow_run (id,workflowId,ownerUserId,triggeredByUserId,triggerType,status,definitionSnapshotJson,inputJson,contextJson,authorizationSnapshotJson,startedAt) VALUES (?,?,?,?,?,'running',?,?,?,?,NOW())",
    [runId, input.workflowId, workflow.ownerUserId, input.triggeredBy.id, "manual", JSON.stringify(definition), JSON.stringify(input.workflowInput ?? {}), JSON.stringify(context), JSON.stringify(authorizationSnapshot)],
  );

  const nodes = new Map(definition.nodes.map(node => [node.id, node]));
  const startNode = definition.nodes.find(node => node.type === "start");
  if (!startNode) throw new Error("流程缺少开始节点。");
  const queue = [startNode.id];
  const executed = new Set<string>();
  let finalOutput: unknown = null;
  const runStartedAt = Date.now();
  try {
    while (queue.length) {
      if (executed.size >= MAX_STEPS) throw new Error("流程执行超过最大节点步数，可能存在循环。");
      const nodeId = queue.shift()!;
      if (executed.has(nodeId)) continue;
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`流程引用了不存在的节点：${nodeId}`);
      executed.add(nodeId);
      const nodeInput = { context: JSON.parse(JSON.stringify(context)), config: node.config };
      const nodeRunId = await insertNodeRun(runId, node, nodeInput);
      const startedAt = Date.now();
      try {
        const result = await executeNode(node, context, true, Number(workflow.ownerUserId));
        const vars = asRecord(context.vars);
        const nodeOutputs = asRecord(context.nodes);
        vars[node.id] = result.output;
        nodeOutputs[node.id] = result.output;
        context.vars = vars;
        context.nodes = nodeOutputs;
        if (node.type === "start") Object.assign(vars, asRecord(result.output));
        if (node.type === "end") finalOutput = result.output;
        await finishNodeRun(nodeRunId, "success", startedAt, result.output);
        const outgoing = definition.edges.filter(edge => edge.sourceNodeId === node.id && (!result.route || (edge.sourceHandle ?? "default") === result.route));
        outgoing.forEach(edge => queue.push(edge.targetNodeId));
      } catch (error) {
        const details = { message: error instanceof Error ? error.message : String(error) };
        await finishNodeRun(nodeRunId, "failed", startedAt, undefined, details);
        throw error;
      }
    }
    await db().query("UPDATE workflow_run SET status='success',contextJson=?,finalOutputJson=?,finishedAt=NOW(),durationMs=? WHERE id=?", [JSON.stringify(context), JSON.stringify(finalOutput), Date.now() - runStartedAt, runId]);
    return { runId, status: "success" as const, output: finalOutput };
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
