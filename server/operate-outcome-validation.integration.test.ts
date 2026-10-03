import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { expect, it } from "vitest";
import { appRouter } from "./routers";
import { createWorkflow } from "./workflow-service";
import type { TrpcContext } from "./_core/context";

const test = process.env.DATABASE_URL ? it : it.skip;
test("错误审批结果可保存草稿，但发布必须拒绝，修复后可发布", async () => {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  const tag = `outcome_${randomUUID().slice(0, 8)}`;
  let userId: number | undefined;
  let workflowId: string | undefined;
  try {
    const [insert] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,'admin','active','internal',NOW())",
      [`test:${tag}`, tag, "结果发布验收"]
    );
    userId = insert.insertId;
    const [users] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM users WHERE id=?",
      [userId]
    );
    const user = users[0] as any;
    const caller = appRouter.createCaller({
      user,
      req: { headers: {} },
      res: {},
    } as unknown as TrpcContext);
    workflowId = (
      (await createWorkflow(user, "结果发布验收", undefined, {
        flowType: "control",
      })) as any
    ).id;
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
          config: { initialVariables: {} },
        },
        {
          id: "review",
          type: "operate",
          name: "审批",
          position: { x: 200, y: 0 },
          config: {
            nodeDh: "REVIEW",
            instruction: "请审批",
            assigneeMode: "initiator",
            outcomeMode: "explicit",
            outcomes: [] as unknown[],
          },
        },
        {
          id: "end",
          type: "end",
          name: "结束",
          position: { x: 400, y: 0 },
          config: { resultTemplate: {} },
        },
      ],
      edges: [
        { id: "e1", sourceNodeId: "start", targetNodeId: "review" },
        {
          id: "e2",
          sourceNodeId: "review",
          targetNodeId: "end",
          sourceHandle: "approved",
        },
      ],
    };
    const valid = {
      code: "approved",
      label: "同意",
      sourceHandle: "approved",
      requireComment: true,
    };
    for (const invalid of [
      null,
      { ...valid, requireComment: "true" },
      { ...valid, code: 1 },
    ]) {
      definition.nodes[1]!.config.outcomes = [valid, invalid];
      await caller.workflow.update({ id: workflowId!, definition });
      await expect(
        caller.workflow.publish({ id: workflowId! })
      ).rejects.toThrow(/操作结果/);
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT status,publishedExecutionPlanHash FROM workflow WHERE id=?",
        [workflowId]
      );
      expect(rows[0]).toMatchObject({
        status: "draft",
        publishedExecutionPlanHash: null,
      });
    }
    definition.nodes[1]!.config.outcomes = [valid];
    await caller.workflow.update({ id: workflowId!, definition });
    await caller.workflow.publish({ id: workflowId! });
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT status,publishedExecutionPlanHash FROM workflow WHERE id=?",
      [workflowId]
    );
    expect(rows[0].status).toBe("published");
    expect(rows[0].publishedExecutionPlanHash).toBeTruthy();
  } finally {
    if (workflowId) {
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    if (userId) {
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=?",
        [userId, userId]
      );
      await pool.query("DELETE FROM users WHERE id=?", [userId]);
    }
    await pool.end();
  }
}, 30_000);
