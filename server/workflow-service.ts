import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";

type Node = { id: string; type: "start" | "end" | "transform" | "condition" | "http" | "llm"; name: string; position: { x: number; y: number }; config: Record<string, unknown> };
type Edge = { id: string; sourceNodeId: string; sourceHandle?: string; targetNodeId: string };
export type Definition = { schemaVersion: 1; viewport: { x: number; y: number; zoom: number }; nodes: Node[]; edges: Edge[]; settings: Record<string, unknown> };
const id = () => randomBytes(12).toString("base64url");
let pool: mysql.Pool | undefined;
const db = () => { if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。"); return pool ??= mysql.createPool(process.env.DATABASE_URL); };
export const emptyDefinition = (): Definition => ({ schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes: [{ id: "start", type: "start", name: "开始", position: { x: 90, y: 180 }, config: { initialVariables: {} } }, { id: "end", type: "end", name: "结束", position: { x: 430, y: 180 }, config: { resultTemplate: "{{result}}" } }], edges: [{ id: "start-end", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "end" }] });
export function validate(definition: unknown, executable = false): Definition {
  const value = definition as Definition;
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error("流程定义格式无效。");
  const starts = value.nodes.filter(node => node.type === "start"), ends = value.nodes.filter(node => node.type === "end");
  if (starts.length !== 1 || ends.length !== 1) throw new Error("流程必须且仅能包含一个开始节点和一个结束节点。");
  if (new Set(value.nodes.map(node => node.id)).size !== value.nodes.length) throw new Error("节点 ID 不可重复。");
  if (executable && !value.edges.some(edge => edge.sourceNodeId === starts[0].id)) throw new Error("开始节点必须连接后继节点。");
  return value;
}
export async function listWorkflows(userId: number) { const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow WHERE ownerUserId=? ORDER BY updatedAt DESC", [userId]); return rows.map(row => ({ ...row, definition: row.definitionJson })); }
export async function getWorkflow(idValue: string, userId: number) { const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM workflow WHERE id=? AND ownerUserId=? LIMIT 1", [idValue, userId]); const row = rows[0]; return row ? { ...row, definition: row.definitionJson } : null; }
export async function createWorkflow(userId: number, name: string, description?: string) { const workflowId = id(); const definition = emptyDefinition(); await db().query("INSERT INTO workflow (id,ownerUserId,name,description,definitionJson,status,definitionVersion) VALUES (?,?,?,?,?,'draft',1)", [workflowId, userId, name, description ?? null, JSON.stringify(definition)]); return getWorkflow(workflowId, userId); }
export async function updateWorkflow(workflowId: string, userId: number, values: { name?: string; definition?: unknown; publish?: boolean }) { const current = await getWorkflow(workflowId, userId) as ({ name: string; status: "draft" | "published"; definition: Definition } | null); if (!current) return null; const definition = values.definition === undefined ? current.definition : validate(values.definition, Boolean(values.publish)); await db().query("UPDATE workflow SET name=?, definitionJson=?, status=?, definitionVersion=definitionVersion+1, updatedAt=NOW() WHERE id=? AND ownerUserId=?", [values.name ?? current.name, JSON.stringify(definition), values.publish ? "published" : current.status, workflowId, userId]); return getWorkflow(workflowId, userId); }
