import { randomUUID } from "node:crypto";
import http from "node:http";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it, vi } from "vitest";
import { executeWorkflow, getWorkflowRun } from "./workflow-engine";
import type { Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const fixture = vi.hoisted(() => ({ port: 0, requests: 0 }));
// Only this test routes the validated public target to a real local socket.
// Production SSRF validation and DNS pinning are unchanged.
vi.mock("node:http", async importOriginal => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      request(
        options: http.RequestOptions,
        callback: (response: http.IncomingMessage) => void
      ) {
        if (
          options.hostname === "1.1.1.1" &&
          String(options.path).startsWith("/integration-fixture/")
        )
          return actual.default.request(
            {
              ...options,
              hostname: "127.0.0.1",
              port: fixture.port,
              lookup: undefined,
            },
            callback
          );
        return actual.default.request(options, callback);
      },
    },
  };
});
const workflowId = randomUUID();
let pool: mysql.Pool | undefined;
let fixtureServer: http.Server | undefined;

const definition: Definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      position: { x: 0, y: 0 },
      config: { initialVariables: { postId: "{{input.postId}}" } },
    },
    {
      id: "http",
      type: "http",
      name: "读取待办",
      position: { x: 200, y: 0 },
      config: {
        url: "http://1.1.1.1/integration-fixture/{{vars.postId}}",
        method: "GET",
      },
    },
    {
      id: "transform",
      type: "transform",
      name: "提取字段",
      position: { x: 400, y: 0 },
      config: {
        mappings: {
          title: "{{nodes.http.body.todo}}",
          completed: "{{nodes.http.body.completed}}",
        },
      },
    },
    {
      id: "condition",
      type: "condition",
      name: "检查状态",
      position: { x: 600, y: 0 },
      config: {
        left: "{{nodes.transform.completed}}",
        operator: "equals",
        right: false,
        trueHandle: "true",
        falseHandle: "false",
      },
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      position: { x: 800, y: 0 },
      config: {
        resultTemplate: {
          title: "{{nodes.transform.title}}",
          completed: "{{nodes.transform.completed}}",
        },
      },
    },
  ],
  edges: [
    {
      id: "start-http",
      sourceNodeId: "start",
      sourceHandle: "default",
      targetNodeId: "http",
    },
    {
      id: "http-transform",
      sourceNodeId: "http",
      sourceHandle: "default",
      targetNodeId: "transform",
    },
    {
      id: "transform-condition",
      sourceNodeId: "transform",
      sourceHandle: "default",
      targetNodeId: "condition",
    },
    {
      id: "condition-end",
      sourceNodeId: "condition",
      sourceHandle: "true",
      targetNodeId: "end",
    },
    {
      id: "condition-false-end",
      sourceNodeId: "condition",
      sourceHandle: "false",
      targetNodeId: "end",
    },
  ],
};

describe("工作流引擎受控 HTTP 与真实 MySQL 集成", () => {
  afterAll(async () => {
    if (fixtureServer)
      await new Promise<void>((resolve, reject) =>
        fixtureServer!.close(error => (error ? reject(error) : resolve()))
      );
    if (pool) {
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query(
        "DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?",
        [workflowId]
      );
      await pool.query("DELETE FROM workflow_task WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow_run WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
      await pool.end();
    }
  });

  runIntegration(
    "可在服务器端完成 HTTP、转换、条件与结束节点并写入节点日志",
    async () => {
      fixtureServer = http.createServer((request, response) => {
        fixture.requests++;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            todo: "受控测试任务",
            completed: request.url === "/integration-fixture/2",
          })
        );
      });
      await new Promise<void>((resolve, reject) => {
        fixtureServer!.once("error", reject);
        fixtureServer!.listen(0, "127.0.0.1", resolve);
      });
      fixture.port = (fixtureServer.address() as { port: number }).port;
      pool = mysql.createPool(process.env.DATABASE_URL!);
      const [users] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id,role FROM users WHERE status='active' ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id LIMIT 1"
      );
      const user = users[0];
      expect(user).toBeTruthy();
      await pool.query(
        "INSERT INTO workflow (id,ownerUserId,name,description,flowType,status,definitionVersion,definitionJson) VALUES (?,?,?,'integration test','control','published',1,?)",
        [
          workflowId,
          user.id,
          "工作流引擎 HTTP 集成测试",
          JSON.stringify(definition),
        ]
      );
      await pool.query(
        "INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)",
        [randomUUID(), workflowId, user.id, user.id]
      );

      for (const postId of [1, 2]) {
        const result = await executeWorkflow({
          workflowId,
          triggeredBy: { id: user.id, role: user.role },
          workflowInput: { postId },
        });
        const detail = await getWorkflowRun(result.runId);

        expect(result.status).toBe("success");
        expect(result.output).toEqual({
          result: { title: "受控测试任务", completed: postId === 2 },
        });
        expect(detail?.status).toBe("success");
        expect(detail?.nodeRuns).toHaveLength(5);
        expect(detail?.nodeRuns.every(node => node.status === "success")).toBe(
          true
        );
        expect(detail?.nodeRuns.map(node => Number(node.sequenceNo))).toEqual([
          1, 2, 3, 4, 5,
        ]);
      }
      expect(fixture.requests).toBe(2);
    },
    30_000
  );
});
