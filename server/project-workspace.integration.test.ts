import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
const ownerUsername = `project_owner_${suffix}`;
const designerUsername = `project_designer_${suffix}`;
const outsiderUsername = `project_outsider_${suffix}`;
let pool: mysql.Pool | undefined;
let owner: any;
let designer: any;
let outsider: any;
let projectId: string | undefined;
let workflowId: string | undefined;
let folderId: string | undefined;
let approvalLock: mysql.PoolConnection | undefined;

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

describe("原始项目工作区 P0", () => {
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
    if (projectId) {
      await pool.query("DELETE FROM workflow_folder WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?,?,?) OR targetUserId IN (?,?,?)", [owner?.id ?? 0, designer?.id ?? 0, outsider?.id ?? 0, owner?.id ?? 0, designer?.id ?? 0, outsider?.id ?? 0]);
    await pool.query("DELETE FROM users WHERE username IN (?,?,?)", [ownerUsername, designerUsername, outsiderUsername]);
    if (approvalLock) { await approvalLock.query("SELECT RELEASE_LOCK('flow_ai_engine_approval_test_lock')"); approvalLock.release(); }
    await pool.end();
  });

  runIntegration("项目成员仅能访问授权项目，并可完成流程审核、发布和仓库归档", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    approvalLock = await pool.getConnection();
    await approvalLock.query("SELECT GET_LOCK('flow_ai_engine_approval_test_lock', 90)");
    await pool.query(
      "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW()),(?,?,?,?,?,?,NOW()),(?,?,?,?,?,?,NOW())",
      [`test:${ownerUsername}`, ownerUsername, "项目所有者", "admin", "active", "internal", `test:${designerUsername}`, designerUsername, "项目设计者", "user", "active", "internal", `test:${outsiderUsername}`, outsiderUsername, "项目外部用户", "user", "active", "internal"],
    );
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?,?)", [ownerUsername, designerUsername, outsiderUsername]);
    owner = users.find(row => row.username === ownerUsername);
    designer = users.find(row => row.username === designerUsername);
    outsider = users.find(row => row.username === outsiderUsername);
    const ownerCaller = callerFor(owner);
    const designerCaller = callerFor(designer);
    const outsiderCaller = callerFor(outsider);

    const project = await ownerCaller.project.create({ code: `OPS${suffix.slice(0, 4)}`.toUpperCase(), name: "原始项目工作区验收", description: "真实数据库 P0 验收" });
    projectId = project.id;
    await ownerCaller.project.grantMember({ projectId, userId: designer.id, role: "designer", expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    await expect(outsiderCaller.project.workflows({ projectId })).rejects.toThrow("项目不存在或当前账号无权执行此操作");
    const created = await designerCaller.project.createWorkflow({ projectId, name: "控制流程验收", description: "项目内控制流程", flowType: "control" });
    workflowId = (created as any).id;
    expect(created).toMatchObject({ projectId, flowType: "control", auditStatus: "init", status: "draft" });
    await expect(designerCaller.workflow.publish({ id: workflowId })).rejects.toThrow("当前审批规则要求项目流程通过审核后才能发布");
    await ownerCaller.project.auditWorkflow({ projectId, workflowId, auditStatus: "approved" });
    await expect(designerCaller.workflow.publish({ id: workflowId })).resolves.toMatchObject({ status: "published", auditStatus: "approved" });
    const visible = await designerCaller.project.workflows({ projectId, flowType: "control", auditStatus: "approved", status: "published" });
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ id: workflowId, projectId, flowType: "control" });
    const completedRun = await ownerCaller.workflow.run({ workflowId, input: { source: "unpublish-retention-test" } });
    expect(completedRun.status).toBe("success");
    await expect(outsiderCaller.workflow.unpublish({ id: workflowId })).rejects.toThrow("流程不存在或无取消发布权限");
    await expect(designerCaller.workflow.unpublish({ id: workflowId })).resolves.toMatchObject({ status: "draft", auditStatus: "approved" });
    const [retainedRuns] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM workflow_run WHERE id=? AND workflowId=?", [completedRun.runId, workflowId]);
    expect(retainedRuns).toHaveLength(1);
    const versionsAfterUnpublish: any[] = await ownerCaller.workflow.versions({ workflowId });
    expect(versionsAfterUnpublish[0]).toMatchObject({ status: "draft", changeSource: "unpublished" });
    const [unpublishAudits] = await pool.query<mysql.RowDataPacket[]>("SELECT detailsJson FROM authorization_audit_log WHERE actorUserId=? AND resourceType='workflow' AND resourceId=? ORDER BY createdAt DESC", [designer.id, workflowId]);
    const unpublishDetails = typeof unpublishAudits[0].detailsJson === "string" ? JSON.parse(unpublishAudits[0].detailsJson) : unpublishAudits[0].detailsJson;
    expect(unpublishDetails).toMatchObject({ operation: "workflow_unpublished", preservedRunHistory: true });
    await expect(ownerCaller.workflow.run({ workflowId, input: {} })).rejects.toThrow("项目流程尚未发布或未通过审核，无法发起运行");
    const folder = await ownerCaller.project.createFolder({ projectId, name: "已发布流程", description: "仓库目录" });
    folderId = folder.id;
    await ownerCaller.project.moveWorkflow({ projectId, workflowId, folderId });
    const warehouse = await designerCaller.project.warehouse({ projectId });
    expect(warehouse.folders.some((entry: any) => entry.id === folderId)).toBe(true);
    expect(warehouse.workflows.find((entry: any) => entry.id === workflowId)).toMatchObject({ folderId, flowType: "control" });
    const exported = await designerCaller.project.exportWorkflows({ projectId, workflowIds: [workflowId] });
    expect(exported[0]).toMatchObject({ id: workflowId, flowType: "control" });
    expect((exported[0] as any).definition.nodes).toHaveLength(2);
    await ownerCaller.project.moveWorkflow({ projectId, workflowId, folderId: null });
    await ownerCaller.project.deleteFolder({ projectId, folderId });
    const afterDelete = await ownerCaller.project.warehouse({ projectId });
    expect(afterDelete.folders.some((entry: any) => entry.id === folderId)).toBe(false);
    folderId = undefined;
    await expect(outsiderCaller.workflow.get({ id: workflowId })).rejects.toThrow("流程不存在或无访问权限");
  }, 60_000);
});
