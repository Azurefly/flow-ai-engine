import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const workflowId = randomUUID();
const ownerUsername = `test_owner_${randomUUID().slice(0, 8)}`;
const viewerUsername = `test_viewer_${randomUUID().slice(0, 8)}`;
const outsiderUsername = `test_outsider_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let owner: any;
let viewer: any;
let outsider: any;
let runId: string | undefined;

const definition: Definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: { trace: "{{input.trace}}" } } },
    { id: "end", type: "end", name: "结束", position: { x: 240, y: 0 }, config: { resultTemplate: { trace: "{{vars.trace}}" } } },
  ],
  edges: [{ id: "start-end", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "end" }],
};

function callerFor(user: any) {
  const ctx = {
    user,
    req: { headers: {}, protocol: "https" },
    res: { cookie: () => undefined, clearCookie: () => undefined },
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}

describe("工作流资源级运行权限", () => {
  afterAll(async () => {
    if (!pool) return;
    if (runId) {
      await pool.query("DELETE FROM workflow_node_run WHERE runId=?", [runId]);
      await pool.query("DELETE FROM workflow_run WHERE id=?", [runId]);
    }
    await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
    await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    await pool.query("DELETE FROM users WHERE username IN (?,?,?)", [ownerUsername, viewerUsername, outsiderUsername]);
    await pool.end();
  });

  runIntegration("所有者可运行、查看者可读日志，未授权用户被拒绝且授权快照已持久化", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    const usersToCreate = [ownerUsername, viewerUsername, outsiderUsername].map(username => [`test:${username}`, username, username, "user", "active", "internal", new Date()]);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES ?", [usersToCreate]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?,?)", [ownerUsername, viewerUsername, outsiderUsername]);
    owner = users.find(row => row.username === ownerUsername);
    viewer = users.find(row => row.username === viewerUsername);
    outsider = users.find(row => row.username === outsiderUsername);
    await pool.query("INSERT INTO workflow (id,ownerUserId,name,status,definitionVersion,definitionJson) VALUES (?,?,?,'published',1,?)", [workflowId, owner.id, "资源权限集成测试", JSON.stringify(definition)]);
    await pool.query("INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?),(?,?,?,'viewer',NOW(),?)", [randomUUID(), workflowId, owner.id, owner.id, randomUUID(), workflowId, viewer.id, owner.id]);

    const ownerCaller = callerFor(owner);
    const result = await ownerCaller.workflow.run({ workflowId, input: { trace: "resource-check" } });
    runId = result.runId;
    const viewerCaller = callerFor(viewer);
    const runs = await viewerCaller.workflow.runs({ workflowId });
    const detail = await viewerCaller.workflow.runDetail({ runId });
    const outsiderCaller = callerFor(outsider);

    await expect(outsiderCaller.workflow.runs({ workflowId })).rejects.toThrow("无权查看流程运行历史");
    await expect(viewerCaller.workflow.run({ workflowId, input: {} })).rejects.toThrow("无权运行此流程");
    expect(result.status).toBe("success");
    expect(runs.some((run: any) => run.id === runId)).toBe(true);
    expect(detail.nodeRuns).toHaveLength(2);
    const snapshot = typeof detail.authorizationSnapshotJson === "string" ? JSON.parse(detail.authorizationSnapshotJson) : detail.authorizationSnapshotJson;
    expect(snapshot).toMatchObject({ userId: owner.id, permission: "workflow:run" });
  }, 30_000);
});
