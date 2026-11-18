import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { executeWorkflow, getWorkflowRun } from "./workflow-engine";
import type { Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL && (process.env.OPENAI_API_KEY || process.env.BUILT_IN_FORGE_API_KEY) ? it : it.skip;
const workflowId = randomUUID();
let runId: string | undefined;
let pool: mysql.Pool | undefined;

const definition: Definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: {} } },
    { id: "llm", type: "llm", name: "运行时 LLM", position: { x: 220, y: 0 }, config: { systemPrompt: "你是流程连通性检查器。只输出 OK。", prompt: "检查工作流：{{input.name}}" } },
    { id: "end", type: "end", name: "结束", position: { x: 440, y: 0 }, config: { resultTemplate: "{{nodes.llm.content}}" } },
  ],
  edges: [
    { id: "start-llm", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "llm" },
    { id: "llm-end", sourceNodeId: "llm", sourceHandle: "default", targetNodeId: "end" },
  ],
};

describe("工作流引擎真实 LLM 节点集成", () => {
  afterAll(async () => {
    if (!pool) return;
    if (runId) {
      await pool.query("DELETE FROM workflow_node_run WHERE runId=?", [runId]);
      await pool.query("DELETE FROM workflow_run WHERE id=?", [runId]);
    }
    await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
    await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    await pool.end();
  });

  runIntegration("自动选择当前目录模型并保存 LLM 节点输出", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT id,role FROM users WHERE status='active' ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id LIMIT 1");
    const user = users[0];
    expect(user).toBeTruthy();
    await pool.query("INSERT INTO workflow (id,ownerUserId,name,flowType,status,definitionVersion,definitionJson) VALUES (?,?,?,'control','published',1,?)", [workflowId, user.id, "工作流引擎 LLM 集成测试", JSON.stringify(definition)]);
    await pool.query("INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)", [randomUUID(), workflowId, user.id, user.id]);
    const result = await executeWorkflow({ workflowId, triggeredBy: { id: user.id, role: user.role }, workflowInput: { name: "LLM 集成测试" } });
    runId = result.runId;
    const detail = await getWorkflowRun(result.runId);
    const llmNode = detail?.nodeRuns.find(node => node.nodeId === "llm");
    const output = typeof llmNode?.outputJson === "string" ? JSON.parse(llmNode.outputJson) : llmNode?.outputJson;

    expect(result.status).toBe("success");
    expect(llmNode?.status).toBe("success");
    expect(output?.model).toBeTruthy();
    expect(output?.content).toBeTruthy();
  }, 90_000);
});
