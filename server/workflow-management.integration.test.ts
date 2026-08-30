import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { listWorkflowMembers } from "./iam-service";
import { createWorkflow, deleteWorkflow, duplicateWorkflow } from "./workflow-service";
import { settleWorkflowCommand } from "./workflow-command-test-support";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const ownerUsername = `repo_owner_${randomUUID().slice(0, 8)}`;
const outsiderUsername = `repo_outsider_${randomUUID().slice(0, 8)}`;
const memberUsername = `repo_member_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let owner: any;
let outsider: any;
let member: any;
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
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId IN (?)", [ids]);
      await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId IN (?)", [ids]);
      await pool.query("DELETE FROM workflow_run WHERE workflowId IN (?)", [ids]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId IN (?)", [ids]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId IN (?)", [ids]);
      await pool.query("DELETE FROM workflow WHERE id IN (?)", [ids]);
    }
    if (owner || outsider || member) await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?,?,?) OR targetUserId IN (?,?,?)", [owner?.id ?? 0, outsider?.id ?? 0, member?.id ?? 0, owner?.id ?? 0, outsider?.id ?? 0, member?.id ?? 0]);
    await pool.query("DELETE FROM users WHERE username IN (?,?,?)", [ownerUsername, outsiderUsername, memberUsername]);
    await pool.end();
  });

  runIntegration("管理员可复制删除流程，并可授予、撤销带有效期的成员角色", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW()),(?,?,?,?,?,?,NOW())", [`test:${ownerUsername}`, ownerUsername, "仓库所有者", "admin", "active", "internal", `test:${outsiderUsername}`, outsiderUsername, "仓库外部用户", "user", "active", "internal"]);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW())", [`test:${memberUsername}`, memberUsername, "流程协作者", "user", "active", "internal"]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?,?)", [ownerUsername, outsiderUsername, memberUsername]);
    owner = users.find(row => row.username === ownerUsername);
    outsider = users.find(row => row.username === outsiderUsername);
    member = users.find(row => row.username === memberUsername);
    const source = await createWorkflow(
      owner,
      "仓库管理集成测试",
      undefined,
      { flowType: "control" }
    );
    sourceId = (source as any).id;
    const copy = await duplicateWorkflow(sourceId, owner, "仓库管理集成测试 · 副本");
    copyId = (copy as any).id;
    const members = await listWorkflowMembers(sourceId);
    const ownerCaller = callerFor(owner);
    const outsiderCaller = callerFor(outsider);

    await expect(outsiderCaller.workflow.members({ workflowId: sourceId })).rejects.toThrow("无权查看流程成员");
    await expect(outsiderCaller.workflow.grantMember({ workflowId: sourceId, userId: member.id, role: "viewer" })).rejects.toThrow("无权管理流程成员");
    await expect((ownerCaller.workflow.run as any)({ workflowId: sourceId, input: ["not-an-object"] })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/record|object/i) });
    await expect(settleWorkflowCommand(pool, await ownerCaller.workflow.run({ workflowId: sourceId, input: {} }))).resolves.toMatchObject({ status: "success" });
    await pool.query("INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,expiresAt,grantedByUserId) VALUES (?,?,?,'viewer',DATE_SUB(NOW(), INTERVAL 2 HOUR),DATE_SUB(NOW(), INTERVAL 1 HOUR),?)", [randomUUID(), sourceId, outsider.id, owner.id]);
    await expect(outsiderCaller.workflow.get({ id: sourceId })).rejects.toThrow("流程不存在或无访问权限");
    await expect(outsiderCaller.workflow.run({ workflowId: sourceId, input: {} })).rejects.toThrow("无权运行");
    await expect(outsiderCaller.workflow.members({ workflowId: sourceId })).rejects.toThrow("无权查看流程成员");
    const candidates = await ownerCaller.workflow.memberCandidates({ workflowId: sourceId });
    expect(candidates.some((candidate: any) => candidate.id === member.id)).toBe(true);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await ownerCaller.workflow.grantMember({ workflowId: sourceId, userId: member.id, role: "operator", expiresAt });
    let granted = await listWorkflowMembers(sourceId);
    const temporaryOperator = granted.find((entry: any) => entry.userId === member.id && entry.role === "operator");
    expect(temporaryOperator).toMatchObject({ revokedAt: null });
    expect(Math.abs(new Date(temporaryOperator.expiresAt).getTime() - expiresAt.getTime())).toBeLessThan(5_000);
    await expect(ownerCaller.workflow.grantMember({ workflowId: sourceId, userId: member.id, role: "viewer", expiresAt: new Date(Date.now() - 60_000) })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "临时授权到期时间必须晚于当前时间。" });
    await expect(callerFor(member).workflow.get({ id: sourceId })).resolves.toMatchObject({ id: sourceId });
    for (const role of ["owner", "editor", "operator", "viewer"] as const) await ownerCaller.workflow.grantMember({ workflowId: sourceId, userId: member.id, role });
    granted = await listWorkflowMembers(sourceId);
    expect(["owner", "editor", "operator", "viewer"].every(role => granted.some((entry: any) => entry.userId === member.id && entry.role === role && !entry.revokedAt))).toBe(true);
    await expect((ownerCaller.workflow.grantMember as any)({ workflowId: sourceId, userId: member.id, role: "invalid" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/owner|editor|operator|viewer/i) });
    await ownerCaller.workflow.revokeMember({ workflowId: sourceId, userId: member.id, role: "operator" });
    granted = await listWorkflowMembers(sourceId);
    expect(granted.find((entry: any) => entry.userId === member.id && entry.role === "operator")?.revokedAt).toBeTruthy();
    expect(members.some((member: any) => member.userId === owner.id && member.role === "owner")).toBe(true);
    expect(copyId).not.toBe(sourceId);
    await expect(deleteWorkflow(copyId, owner)).resolves.toBe(true);
    const [copiedRows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM workflow WHERE id=?", [copyId]);
    expect(copiedRows).toHaveLength(0);
  }, 60_000);
});
