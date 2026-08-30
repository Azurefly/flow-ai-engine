import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
const adminName = `p1_config_admin_${suffix}`;
const userName = `p1_config_user_${suffix}`;
let pool: mysql.Pool | undefined;
let admin: any;
let user: any;
let domainId: string | undefined;
let projectId: string | undefined;
let workflowId: string | undefined;
let previousSettings: mysql.RowDataPacket[] = [];
let approvalLock: mysql.PoolConnection | undefined;

function callerFor(identity: any) {
  return appRouter.createCaller({ user: identity, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

describe("P1 系统配置与工作域", () => {
  afterAll(async () => {
    if (!pool) return;
    if (projectId) {
      await pool.query("DELETE FROM workflow_task WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?", [projectId]);
      await pool.query("DELETE r FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?", [projectId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    if (domainId) await pool.query("DELETE FROM work_domain WHERE id=?", [domainId]);
    await pool.query("DELETE FROM system_setting WHERE `key` IN ('general','approval')");
    for (const setting of previousSettings) await pool.query("INSERT INTO system_setting (`key`,valueJson,updatedByUserId,updatedAt) VALUES (?,?,?,?)", [setting.key, typeof setting.valueJson === "string" ? setting.valueJson : JSON.stringify(setting.valueJson), setting.updatedByUserId, setting.updatedAt]);
    await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?,?) OR targetUserId IN (?,?)", [admin?.id ?? -1, user?.id ?? -1, admin?.id ?? -1, user?.id ?? -1]);
    await pool.query("DELETE FROM users WHERE username IN (?,?)", [adminName, userName]);
    if (approvalLock) { await approvalLock.query("SELECT RELEASE_LOCK('flow_ai_engine_approval_test_lock')"); approvalLock.release(); }
    await pool.end();
  });

  runIntegration("仅管理员可管理系统设置和工作域，水印、审批门禁与项目工作域关联均真实生效", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    approvalLock = await pool.getConnection();
    await approvalLock.query("SELECT GET_LOCK('flow_ai_engine_approval_test_lock', 90)");
    const [settings] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM system_setting WHERE `key` IN ('general','approval')");
    previousSettings = settings;
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW()),(?,?,?,?,?,?,NOW())", [`test:${adminName}`, adminName, "P1 配置管理员", "admin", "active", "internal", `test:${userName}`, userName, "P1 普通成员", "user", "active", "internal"]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?)", [adminName, userName]);
    admin = users.find(row => row.username === adminName);
    user = users.find(row => row.username === userName);
    await expect(callerFor(user).config.settings()).rejects.toThrow();
    await expect(callerFor(admin).config.updateSetting({ key: "general", value: { platformName: "P1 验收引擎", watermarkEnabled: true, watermarkText: "内部资料" } })).resolves.toMatchObject({ platformName: "P1 验收引擎", watermarkEnabled: true, watermarkText: "内部资料" });
    await callerFor(admin).config.updateSetting({ key: "approval", value: { requireProjectApproval: true, reviewerMode: "project_owner_or_admin" } });
    const settingsAfter: any = await callerFor(admin).config.settings();
    expect(settingsAfter.general).toMatchObject({ platformName: "P1 验收引擎", watermarkEnabled: true });
    await expect(callerFor(user).config.publicGeneral()).resolves.toMatchObject({ platformName: "P1 验收引擎", watermarkEnabled: true, watermarkText: "内部资料" });
    domainId = (await callerFor(admin).config.createWorkDomain({ code: `DOM${suffix.slice(0, 5).toUpperCase()}`, name: "P1 验收工作域", description: "隔离配置测试" })).id;
    const domains: any[] = await callerFor(admin).config.workDomains();
    expect(domains.find(domain => domain.id === domainId)).toMatchObject({ name: "P1 验收工作域", status: "active" });
    projectId = (await callerFor(admin).project.create({ code: `P1${suffix.slice(0, 6).toUpperCase()}`, name: "P1 工作域项目", domainId })).id;
    const projects: any[] = await callerFor(admin).project.list();
    expect(projects.find(project => project.id === projectId)).toMatchObject({ domainId, domainCode: `DOM${suffix.slice(0, 5).toUpperCase()}`, domainName: "P1 验收工作域" });
    workflowId = (await callerFor(admin).project.createWorkflow({ projectId, name: "审批配置流程", flowType: "control" })).id;
    await expect(callerFor(admin).workflow.publish({ id: workflowId })).rejects.toThrow("当前审批规则要求项目流程通过审核后才能发布");
    await callerFor(admin).config.updateSetting({ key: "approval", value: { requireProjectApproval: false, reviewerMode: "project_owner_or_admin" } });
    await expect(callerFor(admin).workflow.publish({ id: workflowId })).resolves.toMatchObject({ status: "published" });
    await callerFor(admin).config.updateWorkDomain({ id: domainId!, status: "disabled" });
    const domainsAfter: any[] = await callerFor(admin).config.workDomains();
    expect(domainsAfter.find(domain => domain.id === domainId)).toMatchObject({ status: "disabled", projectCount: 1 });
    await expect(callerFor(user).config.createWorkDomain({ code: "NOACCESS", name: "无权创建" })).rejects.toThrow();
  }, 60_000);
});
