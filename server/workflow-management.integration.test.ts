import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { listWorkflowMembers } from "./iam-service";
import { createWorkflow, deleteWorkflow, duplicateWorkflow } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const ownerUsername = `repo_owner_${randomUUID().slice(0, 8)}`;
const outsiderUsername = `repo_outsider_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let owner: any;
let outsider: any;
let sourceId: string | undefined;
let copyId: string | undefined;

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

describe("流程仓库管理", () => {
  afterAll(async () => {
    if (!pool) return;
    const ids = [sourceId, copyId].filter(Boolean) as string[];
    if (ids.length) {
      await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId IN (?)", [ids]);
      await pool.query("DELETE FROM workflow_run WHERE workflowId IN (?)", [ids]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId IN (?)", [ids]);
      await pool.query("DELETE FROM workflow WHERE id IN (?)", [ids]);
    }
    if (owner || outsider) await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?,?) OR targetUserId IN (?,?)", [owner?.id ?? 0, outsider?.id ?? 0, owner?.id ?? 0, outsider?.id ?? 0]);
    await pool.query("DELETE FROM users WHERE username IN (?,?)", [ownerUsername, outsiderUsername]);
    await pool.end();
  });

  runIntegration("管理员可复制并删除流程，成员可见性受资源权限保护", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW()),(?,?,?,?,?,?,NOW())", [`test:${ownerUsername}`, ownerUsername, "仓库所有者", "admin", "active", "internal", `test:${outsiderUsername}`, outsiderUsername, "仓库外部用户", "user", "active", "internal"]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?)", [ownerUsername, outsiderUsername]);
    owner = users.find(row => row.username === ownerUsername);
    outsider = users.find(row => row.username === outsiderUsername);
    const source = await createWorkflow(owner, "仓库管理集成测试");
    sourceId = (source as any).id;
    const copy = await duplicateWorkflow(sourceId, owner, "仓库管理集成测试 · 副本");
    copyId = (copy as any).id;
    const members = await listWorkflowMembers(sourceId);
    const outsiderCaller = callerFor(outsider);

    await expect(outsiderCaller.workflow.members({ workflowId: sourceId })).rejects.toThrow("无权查看流程成员");
    expect(members.some((member: any) => member.userId === owner.id && member.role === "owner")).toBe(true);
    expect(copyId).not.toBe(sourceId);
    await expect(deleteWorkflow(copyId, owner)).resolves.toBe(true);
    const [copiedRows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM workflow WHERE id=?", [copyId]);
    expect(copiedRows).toHaveLength(0);
  }, 30_000);
});
