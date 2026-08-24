import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createWorkflow } from "./workflow-service";
import { settleWorkflowCommand } from "./workflow-command-test-support";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const ownerUsername = `govern_owner_${randomUUID().slice(0, 8)}`;
const outsiderUsername = `govern_outsider_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let owner: any;
let outsider: any;
let workflowId: string | undefined;
let templateId: string | undefined;
let subflowId: string | undefined;

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

const subflowDefinition = {
  schemaVersion: 1 as const,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    { id: "start", type: "start" as const, name: "开始", position: { x: 20, y: 20 }, config: { initialVariables: { greeting: "已复用" } } },
    { id: "end", type: "end" as const, name: "结束", position: { x: 260, y: 20 }, config: { resultTemplate: "{{vars.greeting}}" } },
  ],
  edges: [{ id: "start-end", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "end" }],
};

describe("流程版本、运行分析与节点复用", () => {
  afterAll(async () => {
    if (!pool) return;
    if (workflowId) {
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_run WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    if (templateId) await pool.query("DELETE FROM workflow_node_template WHERE id=?", [templateId]);
    if (subflowId) await pool.query("DELETE FROM workflow_subflow WHERE id=?", [subflowId]);
    if (owner || outsider) await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?,?) OR targetUserId IN (?,?)", [owner?.id ?? 0, outsider?.id ?? 0, owner?.id ?? 0, outsider?.id ?? 0]);
    await pool.query("DELETE FROM users WHERE username IN (?,?)", [ownerUsername, outsiderUsername]);
    await pool.end();
  });

  runIntegration("版本快照、回滚、告警、个人模板与子流程都遵循资源/用户隔离", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW()),(?,?,?,?,?,?,NOW())", [
      `test:${ownerUsername}`, ownerUsername, "治理所有者", "admin", "active", "internal",
      `test:${outsiderUsername}`, outsiderUsername, "治理外部用户", "user", "active", "internal",
    ]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?)", [ownerUsername, outsiderUsername]);
    owner = users.find(user => user.username === ownerUsername);
    outsider = users.find(user => user.username === outsiderUsername);
    const ownerCaller = callerFor(owner);
    const outsiderCaller = callerFor(outsider);

    const workflow = await createWorkflow(owner, "版本治理验收流程");
    workflowId = (workflow as any).id;

    await ownerCaller.workflow.update({
      id: workflowId,
      definition: {
        ...subflowDefinition,
        nodes: [
          subflowDefinition.nodes[0],
          { id: "map", type: "transform", name: "补充映射", position: { x: 140, y: 120 }, config: { mappings: { value: "{{input.value}}" } } },
          subflowDefinition.nodes[1],
        ],
        edges: [
          { id: "start-map", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "map" },
          { id: "map-end", sourceNodeId: "map", sourceHandle: "default", targetNodeId: "end" },
        ],
      },
    });
    const versions = await ownerCaller.workflow.versions({ workflowId });
    expect(versions.map((version: any) => version.version)).toEqual([2, 1]);
    const diff = await ownerCaller.workflow.versionDiff({ workflowId, fromVersion: 1, toVersion: 2 });
    expect(diff.addedNodes).toContainEqual(expect.objectContaining({ id: "map", type: "transform" }));
    await expect(outsiderCaller.workflow.versions({ workflowId })).rejects.toThrow("无权查看流程版本");
    await ownerCaller.workflow.rollbackVersion({ workflowId, targetVersion: 1 });
    const afterRollback = await ownerCaller.workflow.versions({ workflowId });
    expect(afterRollback[0]).toMatchObject({ version: 3, changeSource: "rolled_back", restoredFromVersion: 1 });

    const template = await ownerCaller.workflow.createTemplate({ name: "字段映射模板", nodeType: "transform", config: { mappings: { output: "{{input.value}}" } } });
    templateId = template.id;
    expect((await ownerCaller.workflow.templates()).some((item: any) => item.id === templateId)).toBe(true);
    await ownerCaller.workflow.updateTemplate({ id: templateId, name: "字段映射模板 · 已编辑", config: { mappings: { output: "{{input.edited}}" } } });
    const editedTemplate = (await ownerCaller.workflow.templates()).find((item: any) => item.id === templateId);
    expect(editedTemplate).toMatchObject({ name: "字段映射模板 · 已编辑", config: { mappings: { output: "{{input.edited}}" } } });
    expect((await outsiderCaller.workflow.templates()).some((item: any) => item.id === templateId)).toBe(false);
    await expect(outsiderCaller.workflow.deleteTemplate({ id: templateId })).rejects.toThrow("节点模板不存在或无删除权限");

    const subflow = await ownerCaller.workflow.createSubflow({ name: "问候子流程", definition: subflowDefinition });
    subflowId = subflow.id;
    expect((await ownerCaller.workflow.subflows()).some((item: any) => item.id === subflowId)).toBe(true);
    expect((await outsiderCaller.workflow.subflows()).some((item: any) => item.id === subflowId)).toBe(false);
    await ownerCaller.workflow.grantMember({ workflowId, userId: outsider.id, role: "editor" });
    await expect(outsiderCaller.workflow.update({
      id: workflowId,
      definition: {
        ...subflowDefinition,
        nodes: [subflowDefinition.nodes[0], { id: "foreign-call", type: "subflow", name: "越权调用", position: { x: 180, y: 20 }, config: { subflowId } }, subflowDefinition.nodes[1]],
        edges: [{ id: "start-foreign", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "foreign-call" }, { id: "foreign-end", sourceNodeId: "foreign-call", sourceHandle: "default", targetNodeId: "end" }],
      },
    })).rejects.toThrow("流程只能引用流程所有者创建的私有子流程");
    await ownerCaller.workflow.update({
      id: workflowId,
      definition: {
        ...subflowDefinition,
        nodes: [
          subflowDefinition.nodes[0],
          { id: "call", type: "subflow", name: "调用问候", position: { x: 180, y: 20 }, config: { subflowId } },
          { ...subflowDefinition.nodes[1], config: { resultTemplate: "{{nodes.call.result.result}}" } },
        ],
        edges: [
          { id: "start-call", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "call" },
          { id: "call-end", sourceNodeId: "call", sourceHandle: "default", targetNodeId: "end" },
        ],
      },
    });
    await expect(settleWorkflowCommand(pool, await ownerCaller.workflow.run({ workflowId, input: {} }))).resolves.toMatchObject({ status: "success", output: { result: "已复用" } });

    await ownerCaller.workflow.update({
      id: workflowId,
      definition: {
        ...subflowDefinition,
        nodes: [
          subflowDefinition.nodes[0],
          { id: "unsafe", type: "http", name: "受限地址", position: { x: 160, y: 20 }, config: { method: "GET", url: "http://127.0.0.1/" } },
          subflowDefinition.nodes[1],
        ],
        edges: [
          { id: "start-unsafe", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "unsafe" },
          { id: "unsafe-end", sourceNodeId: "unsafe", sourceHandle: "default", targetNodeId: "end" },
        ],
      },
    });
    const unsafeCommand = await ownerCaller.workflow.run({ workflowId, input: {} });
    await expect(settleWorkflowCommand(pool, unsafeCommand)).rejects.toThrow("拒绝私有");
    const failedRuns = await ownerCaller.workflow.runs({ workflowId, status: "failed" });
    expect(failedRuns).toHaveLength(1);
    const metrics = await ownerCaller.workflow.runMetrics({ workflowId });
    expect(metrics).toMatchObject({ totalRuns: 2, successfulRuns: 1, failedRuns: 1, failureRate: 50 });
    const alerts = await ownerCaller.workflow.alerts();
    const alert = alerts.find((item: any) => item.workflowId === workflowId && !item.readAt);
    expect(alert).toBeTruthy();
    await ownerCaller.workflow.markAlertRead({ alertId: alert.id });
    expect((await ownerCaller.workflow.alerts()).find((item: any) => item.id === alert.id)?.readAt).toBeTruthy();
  }, 60_000);
});
