import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { runDataflow } from "./p2-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
const adminName = `p2_admin_${suffix}`;
const viewerName = `p2_viewer_${suffix}`;
let pool: mysql.Pool | undefined;
let admin: any;
let viewer: any;
let projectId: string | undefined;
let workflowId: string | undefined;

function callerFor(identity: any) {
  return appRouter.createCaller({
    user: identity,
    req: { headers: {}, protocol: "https" },
    res: {},
  } as unknown as TrpcContext);
}

describe("P2 项目数据资源与数据流", () => {
  afterAll(async () => {
    if (!pool) return;
    if (projectId) {
      await pool.query("DELETE FROM dataflow_schedule WHERE projectId=?", [
        projectId,
      ]);
      await pool.query("DELETE FROM dataflow_run WHERE projectId=?", [
        projectId,
      ]);
      await pool.query("DELETE FROM data_asset WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM data_source WHERE projectId=?", [
        projectId,
      ]);
      await pool.query("DELETE FROM data_udf WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM data_tag WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM project_plugin WHERE projectId=?", [
        projectId,
      ]);
      await pool.query(
        "DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query(
        "DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query("DELETE FROM workflow WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [
        projectId,
      ]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    await pool.query(
      "DELETE FROM authorization_audit_log WHERE actorUserId IN (?,?) OR targetUserId IN (?,?)",
      [admin?.id ?? -1, viewer?.id ?? -1, admin?.id ?? -1, viewer?.id ?? -1]
    );
    await pool.query("DELETE FROM users WHERE username IN (?,?)", [
      adminName,
      viewerName,
    ]);
    await pool.end();
  });

  runIntegration(
    "资源、样本和数据流运行严格受项目边界保护",
    async () => {
      pool = mysql.createPool(process.env.DATABASE_URL!);
      await pool.query(
        "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW()),(?,?,?,?,?,?,NOW())",
        [
          `test:${adminName}`,
          adminName,
          "P2 管理员",
          "admin",
          "active",
          "internal",
          `test:${viewerName}`,
          viewerName,
          "P2 查看者",
          "user",
          "active",
          "internal",
        ]
      );
      const [users] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT * FROM users WHERE username IN (?,?)",
        [adminName, viewerName]
      );
      admin = users.find(row => row.username === adminName);
      viewer = users.find(row => row.username === viewerName);
      const owner = callerFor(admin);
      const readonly = callerFor(viewer);

      projectId = (
        await owner.project.create({
          code: `DAT${suffix.slice(0, 5).toUpperCase()}`,
          name: "P2 数据资源验收",
        })
      ).id;
      await owner.project.grantMember({
        projectId,
        userId: viewer.id,
        role: "viewer",
      });
      await expect(
        owner.data.createSource({
          projectId,
          name: "禁止明文密钥",
          sourceType: "api",
          connection: {
            endpoint: "https://example.invalid",
            token: "plaintext",
          },
        })
      ).rejects.toThrow("明文凭据");
      const sourceId = (
        await owner.data.createSource({
          projectId,
          name: "订单内联源",
          sourceType: "inline",
          connection: { description: "浏览器验收内联样本" },
        })
      ).id;
      const assetId = (
        await owner.data.createAsset({
          projectId,
          sourceId,
          name: "订单样本",
          assetType: "dataset",
          schema: [
            { name: "orderId", type: "string" },
            { name: "amount", type: "number" },
          ],
          sample: [
            { orderId: "A-01", amount: 12, ignored: "x" },
            { orderId: "A-02", amount: 34, ignored: "y" },
          ],
        })
      ).id;
      await owner.data.createTag({
        projectId,
        name: "关键数据",
        color: "#245FC8",
      });
      await owner.data.createUdf({
        projectId,
        name: "金额标准化",
        udfType: "javascript",
        params: [{ name: "amount", type: "number" }],
        returnType: "number",
      });
      await owner.data.createPlugin({
        projectId,
        name: "表格预览",
        pluginType: "visualization",
        version: "1.0.0",
        config: { renderer: "grid" },
      });

      const view = await readonly.data.resources({ projectId });
      expect(view.sources).toHaveLength(1);
      expect(view.sources[0]).toMatchObject({
        status: "draft",
        lastTestedAt: null,
      });
      expect(view.assets[0]).toMatchObject({ id: assetId, name: "订单样本" });
      expect(view.sources[0]).not.toHaveProperty("credentialRef");
      await expect(
        readonly.data.createTag({ projectId, name: "越权标签" })
      ).rejects.toThrow("无权");

      const definition = {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        nodes: [
          {
            id: "start",
            type: "start",
            name: "开始",
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: "source",
            type: "source",
            name: "读取订单样本",
            position: { x: 180, y: 0 },
            config: { assetId },
          },
          {
            id: "transform",
            type: "transform",
            name: "选择字段",
            position: { x: 360, y: 0 },
            config: { columns: ["orderId", "amount"] },
          },
          {
            id: "sql",
            type: "edit_sql",
            name: "只读 SQL",
            position: { x: 540, y: 0 },
            config: { sql: "SELECT orderId, amount FROM orders" },
          },
          {
            id: "end",
            type: "end",
            name: "结束",
            position: { x: 720, y: 0 },
            config: {},
          },
        ],
        edges: [
          { id: "e1", sourceNodeId: "start", targetNodeId: "source" },
          { id: "e2", sourceNodeId: "source", targetNodeId: "transform" },
          { id: "e3", sourceNodeId: "transform", targetNodeId: "sql" },
          { id: "e4", sourceNodeId: "sql", targetNodeId: "end" },
        ],
      };
      workflowId = (
        await owner.project.createWorkflow({
          projectId,
          name: "订单数据流",
          flowType: "data",
          definition,
        })
      ).id;
      await owner.project.auditWorkflow({
        projectId,
        workflowId,
        auditStatus: "approved",
      });
      await owner.workflow.publish({ id: workflowId });
      const run = await owner.data.run({ projectId, workflowId });
      expect(run.status).toBe("success");
      expect((run.output.terminals[0] as any).rows).toEqual([
        { orderId: "A-01", amount: 12 },
        { orderId: "A-02", amount: 34 },
      ]);
      const [jobRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT status,attempt,leaseToken FROM dataflow_run_job WHERE runId=?",
        [run.runId]
      );
      expect(jobRows[0]).toMatchObject({
        status: "completed",
        attempt: 1,
        leaseToken: null,
      });
      const [nodeRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT nodeId,sequenceNo,status,attempt FROM dataflow_node_run WHERE runId=? ORDER BY sequenceNo",
        [run.runId]
      );
      expect(nodeRows).toHaveLength(5);
      expect(nodeRows.map(row => Number(row.sequenceNo))).toEqual([
        0, 1, 2, 3, 4,
      ]);
      expect(
        nodeRows.every(
          row => row.status === "success" && Number(row.attempt) === 1
        )
      ).toBe(true);
      const runs = await owner.data.runs({ projectId, workflowId });
      expect(runs[0]).toMatchObject({
        id: run.runId,
        status: "success",
        triggerType: "manual",
      });
      const scheduleBucket = `trusted-task:${new Date().toISOString().slice(0, 16)}`;
      const scheduled = await runDataflow(admin, {
        projectId,
        workflowId,
        triggerType: "schedule",
        scheduleBucket,
      });
      await expect(
        runDataflow(admin, {
          projectId,
          workflowId,
          triggerType: "schedule",
          scheduleBucket,
        })
      ).rejects.toThrow();
      const [duplicateRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id FROM dataflow_run WHERE workflowId=? AND scheduleBucket=?",
        [workflowId, scheduleBucket]
      );
      expect(duplicateRows).toHaveLength(1);
      expect(duplicateRows[0].id).toBe(scheduled.runId);
      await expect(
        owner.data.saveScheduleDraft({
          projectId,
          workflowId,
          cronExpression: "0 0 9 * * *",
        })
      ).resolves.toMatchObject({
        status: "paused",
        cronExpression: "0 0 9 * * *",
      });
      await expect(
        owner.data.saveScheduleDraft({
          projectId,
          workflowId,
          cronExpression: "0 9 * * *",
        })
      ).rejects.toThrow("6 段 UTC");
      await expect(
        readonly.data.saveScheduleDraft({
          projectId,
          workflowId,
          cronExpression: "0 0 9 * * *",
        })
      ).rejects.toThrow("无权");
      const schedules = await owner.data.schedules({ projectId });
      expect(schedules[0]).toMatchObject({
        workflowId,
        status: "paused",
        cronExpression: "0 0 9 * * *",
        taskConfigured: false,
      });
    },
    90_000
  );
});
