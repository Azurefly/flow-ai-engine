import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createWorkflow, deleteWorkflow, duplicateWorkflow, getWorkflow, type Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const username = `definition_test_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let user: any;
let workflowId: string | undefined;
let copyId: string | undefined;
let subflowId: string | undefined;

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

const importedDefinition: Definition = {
  schemaVersion: 1,
  viewport: { x: 48, y: 32, zoom: 1.15 },
  settings: { trace: true },
  nodes: [
    { id: "start", type: "start", name: "输入", position: { x: 0, y: 0 }, config: { initialVariables: { city: "{{input.city}}" } } },
    { id: "state", type: "state", name: "业务状态", position: { x: 190, y: 0 }, config: { stateCode: "SUBMITTED", displayName: "已提交", stateType: "business" } },
    { id: "operate", type: "operate", name: "人工处理", position: { x: 380, y: 0 }, config: { commandCode: "REVIEW", assigneeMode: "role", instruction: "请审核 {{vars.city}} 的申请。", assigneeRole: "reviewer" } },
    { id: "router", type: "router", name: "路由", position: { x: 570, y: 0 }, config: { routes: [{ handle: "approved", label: "通过", condition: { left: "{{input.status}}", operator: "equals", right: "approved" } }], defaultRoute: "default" } },
    { id: "rest", type: "rest", name: "外部通知", position: { x: 760, y: 0 }, config: { endpoint: "https://example.com/notify", method: "POST", headers: { "X-Flow": "{{vars.city}}" }, body: { city: "{{vars.city}}" }, timeout: 15000 } },
    { id: "form", type: "form", name: "补充信息", position: { x: 950, y: 0 }, config: { fields: [{ key: "comment", label: "处理意见", type: "textarea", required: true, placeholder: "请输入处理意见" }] } },
    { id: "transform", type: "transform", name: "结果转换", position: { x: 1140, y: 0 }, config: { mappings: { city: "{{vars.city}}", comment: "{{input.comment}}" } } },
    { id: "condition", type: "condition", name: "完整性检查", position: { x: 1330, y: 0 }, config: { left: "{{nodes.transform.comment}}", operator: "exists", right: true, trueHandle: "true", falseHandle: "false" } },
    { id: "llm", type: "llm", name: "智能摘要", position: { x: 1520, y: 0 }, config: { model: "", systemPrompt: "你是一名严谨的工作流助手。", prompt: "总结 {{nodes.transform.comment}}", maxTokens: 512 } },
    { id: "subflow", type: "subflow", name: "后续子流程", position: { x: 1710, y: 0 }, config: { subflowId: "private-subflow-reference", input: { city: "{{vars.city}}" } } },
    { id: "http", type: "http", name: "兼容回调", position: { x: 1900, y: 0 }, config: { url: "https://example.com/callback", method: "PUT", headers: { "X-Flow": "{{vars.city}}" }, body: { summary: "{{nodes.llm.text}}" }, timeout: 12000 } },
    { id: "end", type: "end", name: "输出", position: { x: 2090, y: 0 }, config: { resultTemplate: { text: "{{nodes.http.body}}" } } },
  ],
  edges: [
    { id: "start-state", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "state" },
    { id: "state-operate", sourceNodeId: "state", sourceHandle: "default", targetNodeId: "operate" },
    { id: "operate-router", sourceNodeId: "operate", sourceHandle: "default", targetNodeId: "router" },
    { id: "router-rest", sourceNodeId: "router", sourceHandle: "default", targetNodeId: "rest" },
    { id: "rest-form", sourceNodeId: "rest", sourceHandle: "default", targetNodeId: "form" },
    { id: "form-transform", sourceNodeId: "form", sourceHandle: "default", targetNodeId: "transform" },
    { id: "transform-condition", sourceNodeId: "transform", sourceHandle: "default", targetNodeId: "condition" },
    { id: "condition-llm", sourceNodeId: "condition", sourceHandle: "true", targetNodeId: "llm" },
    { id: "llm-subflow", sourceNodeId: "llm", sourceHandle: "default", targetNodeId: "subflow" },
    { id: "subflow-http", sourceNodeId: "subflow", sourceHandle: "default", targetNodeId: "http" },
    { id: "http-end", sourceNodeId: "http", sourceHandle: "default", targetNodeId: "end" },
  ],
};

describe("流程定义 JSON 导入导出与持久化", () => {
  afterAll(async () => {
    if (!pool) return;
    if (copyId) await deleteWorkflow(copyId, user);
    if (workflowId) await deleteWorkflow(workflowId, user);
    if (subflowId) await pool.query("DELETE FROM workflow_subflow WHERE id=?", [subflowId]);
    if (user) {
      await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=?", [user.id, user.id]);
      await pool.query("DELETE FROM users WHERE id=?", [user.id]);
    }
    await pool.end();
  });

  runIntegration("导入 JSON 后保存、重读、导出再解析和复制均保持完整定义", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW())", [`test:${username}`, username, "定义持久化测试", "admin", "active", "internal"]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username=?", [username]);
    user = users[0];
    const workflow = await createWorkflow(user, "导入导出测试");
    workflowId = (workflow as any).id;
    const initialVersion = Number((workflow as any).definitionVersion);

    const imported = JSON.parse(JSON.stringify(importedDefinition)) as Definition;
    const routeCaller = callerFor(user);
    const subflow = await routeCaller.workflow.createSubflow({
      name: "定义持久化引用子流程",
      definition: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        nodes: [
          { id: "subflow-start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: {} } },
          { id: "subflow-end", type: "end", name: "结束", position: { x: 160, y: 0 }, config: { resultTemplate: "{{vars}}" } },
        ],
        edges: [{ id: "subflow-start-end", sourceNodeId: "subflow-start", sourceHandle: "default", targetNodeId: "subflow-end" }],
      },
    });
    subflowId = subflow.id;
    const subflowNode = imported.nodes.find(node => node.id === "subflow");
    if (!subflowNode) throw new Error("测试定义缺少子流程节点。");
    delete subflowNode.config.subflowId;
    subflowNode.config.zlcxz = { id: subflowId, text: "定义持久化引用子流程" };
    const invalidImported = JSON.parse(JSON.stringify(importedDefinition)) as Definition;
    (invalidImported.nodes[1] as any).config = [];
    await expect(routeCaller.workflow.update({ id: workflowId, definition: invalidImported })).rejects.toThrow("节点配置必须是 JSON 对象");
    const routedUpdate = await routeCaller.workflow.update({ id: workflowId, name: "导入定义已保存", definition: imported });
    await expect(
      routeCaller.workflow.update({
        id: workflowId,
        expectedDefinitionVersion: initialVersion,
        definition: imported,
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("流程版本冲突"),
    });
    const reloaded = await getWorkflow(workflowId, user) as any;
    const routedExport = await routeCaller.workflow.get({ id: workflowId });
    const exportedJson = JSON.stringify({ workflow: { name: routedExport.name, definition: routedExport.definition } });
    const reimported = JSON.parse(exportedJson).workflow.definition as Definition;
    const copy = await duplicateWorkflow(workflowId, user, "导入定义副本");
    copyId = (copy as any).id;

    const expectedImported = JSON.parse(JSON.stringify(imported)) as Definition;
    const expectedSubflowNode = expectedImported.nodes.find(node => node.id === "subflow");
    if (!expectedSubflowNode) throw new Error("期望定义缺少子流程节点。");
    expectedSubflowNode.config.subflowId = subflowId;
    expect(reloaded.definition).toEqual(expectedImported);
    expect(reimported).toEqual(expectedImported);
    expect((copy as any).definition).toEqual(expectedImported);
    expect(Number(routedUpdate.definitionVersion)).toBe(initialVersion + 1);
    expect(Number(reloaded.definitionVersion)).toBe(initialVersion + 1);
  }, 45_000);
});
