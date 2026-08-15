import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { executeWorkflow, getWorkflowRun } from "./workflow-engine";
import type { Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const workflowId = randomUUID();
let runId: string | undefined;
let pool: mysql.Pool | undefined;

const definition: Definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: { postId: "{{input.postId}}" } } },
    { id: "http", type: "http", name: "读取待办", position: { x: 200, y: 0 }, config: { url: "https://jsonplaceholder.typicode.com/todos/{{vars.postId}}", method: "GET" } },
    { id: "transform", type: "transform", name: "提取字段", position: { x: 400, y: 0 }, config: { mappings: { title: "{{nodes.http.body.title}}", completed: "{{nodes.http.body.completed}}" } } },
    { id: "condition", type: "condition", name: "检查状态", position: { x: 600, y: 0 }, config: { left: "{{nodes.transform.completed}}", operator: "equals", right: false, trueHandle: "true", falseHandle: "false" } },
    { id: "end", type: "end", name: "结束", position: { x: 800, y: 0 }, config: { resultTemplate: { title: "{{nodes.transform.title}}", completed: "{{nodes.transform.completed}}" } } },
  ],
  edges: [
    { id: "start-http", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "http" },
    { id: "http-transform", sourceNodeId: "http", sourceHandle: "default", targetNodeId: "transform" },
    { id: "transform-condition", sourceNodeId: "transform", sourceHandle: "default", targetNodeId: "condition" },
    { id: "condition-end", sourceNodeId: "condition", sourceHandle: "true", targetNodeId: "end" },
  ],
};

describe("工作流引擎真实 HTTP 集成", () => {
  afterAll(async () => {
    if (pool) {
      if (runId) {
        await pool.query("DELETE FROM workflow_node_run WHERE runId=?", [runId]);
        await pool.query("DELETE FROM workflow_run WHERE id=?", [runId]);
      }
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
      await pool.end();
    }
  });

  runIntegration("可在服务器端完成 HTTP、转换、条件与结束节点并写入节点日志", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT id,role FROM users WHERE status='active' ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id LIMIT 1");
    const user = users[0];
    expect(user).toBeTruthy();
    await pool.query("INSERT INTO workflow (id,ownerUserId,name,description,status,definitionVersion,definitionJson) VALUES (?,?,?,'integration test','published',1,?)", [workflowId, user.id, "工作流引擎 HTTP 集成测试", JSON.stringify(definition)]);
    await pool.query("INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)", [randomUUID(), workflowId, user.id, user.id]);

    const result = await executeWorkflow({ workflowId, triggeredBy: { id: user.id, role: user.role }, workflowInput: { postId: 2 } });
    runId = result.runId;
    const detail = await getWorkflowRun(result.runId);

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ result: { title: "quis ut nam facilis et officia qui", completed: false } });
    expect(detail?.status).toBe("success");
    expect(detail?.nodeRuns).toHaveLength(5);
    expect(detail?.nodeRuns.every(node => node.status === "success")).toBe(true);
  }, 30_000);
});
