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

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

const importedDefinition: Definition = {
  schemaVersion: 1,
  viewport: { x: 48, y: 32, zoom: 1.15 },
  settings: { trace: true },
  nodes: [
    { id: "start", type: "start", name: "输入", position: { x: 0, y: 0 }, config: { initialVariables: { city: "{{input.city}}" } } },
    { id: "transform", type: "transform", name: "映射", position: { x: 220, y: 0 }, config: { mappings: { greeting: "你好，{{vars.city}}" } } },
    { id: "end", type: "end", name: "输出", position: { x: 440, y: 0 }, config: { resultTemplate: { text: "{{nodes.transform.greeting}}" } } },
  ],
  edges: [
    { id: "start-transform", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "transform" },
    { id: "transform-end", sourceNodeId: "transform", sourceHandle: "default", targetNodeId: "end" },
  ],
};

describe("流程定义 JSON 导入导出与持久化", () => {
  afterAll(async () => {
    if (!pool) return;
    if (copyId) await deleteWorkflow(copyId, user);
    if (workflowId) await deleteWorkflow(workflowId, user);
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
    const invalidImported = JSON.parse(JSON.stringify(importedDefinition)) as Definition;
    (invalidImported.nodes[1] as any).config = [];
    await expect(routeCaller.workflow.update({ id: workflowId, definition: invalidImported })).rejects.toThrow("节点配置必须是 JSON 对象");
    const routedUpdate = await routeCaller.workflow.update({ id: workflowId, name: "导入定义已保存", definition: imported });
    const reloaded = await getWorkflow(workflowId, user) as any;
    const routedExport = await routeCaller.workflow.get({ id: workflowId });
    const exportedJson = JSON.stringify({ workflow: { name: routedExport.name, definition: routedExport.definition } });
    const reimported = JSON.parse(exportedJson).workflow.definition as Definition;
    const copy = await duplicateWorkflow(workflowId, user, "导入定义副本");
    copyId = (copy as any).id;

    expect(reloaded.definition).toEqual(importedDefinition);
    expect(reimported).toEqual(importedDefinition);
    expect((copy as any).definition).toEqual(importedDefinition);
    expect(Number(routedUpdate.definitionVersion)).toBe(initialVersion + 1);
    expect(Number(reloaded.definitionVersion)).toBe(initialVersion + 1);
  }, 45_000);
});
