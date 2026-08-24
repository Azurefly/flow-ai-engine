import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createCustomRole, assignRole } from "./iam-service";
import { appRouter } from "./routers";
import { createProject, createProjectWorkflow, grantProjectMember, setProjectWorkflowAudit } from "./project-service";
import { updateWorkflow, type Definition } from "./workflow-service";
import { createAnnualLeaveApprovalDefinition, createReportingApprovalDefinition, createResignationApprovalDefinition } from "../shared/company-workflows";
import { settleWorkflowCommand } from "./workflow-command-test-support";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
const roleCode = `custom_company_it_${suffix}`;
let pool: mysql.Pool | undefined;
let projectId: string | undefined;
let workflowIds: string[] = [];
let users: any[] = [];

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: { cookie: () => undefined, clearCookie: () => undefined } } as unknown as TrpcContext);
}

async function createWorkflow(owner: any, name: string, definition: Definition) {
  const workflow = await createProjectWorkflow(owner, { projectId: projectId!, name, flowType: "state", definition });
  workflowIds.push(workflow.id);
  await setProjectWorkflowAudit(owner, { projectId: projectId!, workflowId: workflow.id, auditStatus: "approved" });
  await updateWorkflow(workflow.id, owner, { publish: true });
  return workflow.id;
}

describe("公司组织多流程真实 MySQL 演示", () => {
  afterAll(async () => {
    if (!pool) return;
    for (const workflowId of workflowIds) {
      await pool.query("DELETE FROM workflow_task WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_task_group WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_participant_state WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_run WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM role_assignment WHERE scopeType='workflow' AND scopeId=?", [workflowId]);
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    if (projectId) {
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    const [roles] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM iam_role WHERE code=?", [roleCode]);
    if (roles[0]) { await pool.query("DELETE FROM role_assignment WHERE roleId=?", [roles[0].id]); await pool.query("DELETE FROM role_permission WHERE roleId=?", [roles[0].id]); await pool.query("DELETE FROM iam_role WHERE id=?", [roles[0].id]); }
    const ids = users.map(user => user.id).filter(Boolean);
    if (ids.length) await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)", [ids, ids]);
    if (ids.length) await pool.query("DELETE FROM users WHERE id IN (?)", [ids]);
    await pool.end();
  });

  runIntegration("验证辞职会签、汇报或签和年假 3 天分支均写入真实任务与状态", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES ?", [[
      [`test:company-${suffix}-owner`, `company_it_owner_${suffix}`, "公司流程管理员", "admin", "active", "internal", new Date()],
      [`test:company-${suffix}-employee`, `company_it_employee_${suffix}`, "演示员工", "user", "active", "internal", new Date()],
      [`test:company-${suffix}-approver1`, `company_it_approver1_${suffix}`, "审批人一", "user", "active", "internal", new Date()],
      [`test:company-${suffix}-approver2`, `company_it_approver2_${suffix}`, "审批人二", "user", "active", "internal", new Date()],
    ]]);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username LIKE ? ORDER BY id", [`company_it_%_${suffix}`]);
    users = rows;
    const [owner, employee, approver1, approver2] = rows;
    await createCustomRole({ code: roleCode, name: "公司流程集成审批人", scope: "system", permissions: ["workflow:view", "workflow:run"], actorUserId: owner.id });
    await assignRole({ userId: approver1.id, roleCode, scopeType: "system", grantedByUserId: owner.id });
    await assignRole({ userId: approver2.id, roleCode, scopeType: "system", grantedByUserId: owner.id });
    projectId = await createProject(owner, { code: `CI${suffix.toUpperCase()}`, name: "公司流程集成" });
    for (const user of [employee, approver1, approver2]) await grantProjectMember(owner, { projectId, userId: user.id, role: "operator" });

    const annualId = await createWorkflow(owner, "年假分支集成", createAnnualLeaveApprovalDefinition(roleCode) as Definition);
    const shortRun: any = await settleWorkflowCommand(pool, await callerFor(employee).workflow.run({ workflowId: annualId, input: { days: 3, reason: "短假" } }));
    expect(shortRun.status).toBe("waiting");
    const shortTodos: any[] = await callerFor(approver1).task.list({ view: "todo", projectId });
    const shortTask = shortTodos.find(item => item.runId === shortRun.runId);
    expect(shortTask).toBeTruthy();
    const shortResult: any = await settleWorkflowCommand(pool, await callerFor(approver1).task.execute({ taskId: shortTask.id, result: { decision: "approved" } }));
    expect(shortResult.status).toBe("success");

    const longRun: any = await settleWorkflowCommand(pool, await callerFor(employee).workflow.run({ workflowId: annualId, input: { days: 5, reason: "长假" } }));
    const longTodos: any[] = await callerFor(approver1).task.list({ view: "todo", projectId });
    const longSupervisorTask = longTodos.find(item => item.runId === longRun.runId);
    expect(longSupervisorTask).toBeTruthy();
    const afterSupervisor: any = await settleWorkflowCommand(pool, await callerFor(approver1).task.execute({ taskId: longSupervisorTask.id, result: { decision: "approved" } }));
    expect(afterSupervisor.status).toBe("waiting");
    const managerTodos: any[] = await callerFor(approver2).task.list({ view: "todo", projectId });
    const managerTask = managerTodos.find(item => item.runId === longRun.runId);
    expect(managerTask).toBeTruthy();
    expect((await settleWorkflowCommand(pool, await callerFor(approver2).task.execute({ taskId: managerTask.id, result: { decision: "approved" } }))).status).toBe("success");

    const resignId = await createWorkflow(owner, "辞职会签集成", createResignationApprovalDefinition(roleCode) as Definition);
    const resignRun: any = await settleWorkflowCommand(pool, await callerFor(employee).workflow.run({ workflowId: resignId, input: { resignationReason: "职业规划" } }));
    const resignTodos1: any[] = await callerFor(approver1).task.list({ view: "todo", projectId });
    const resignTask1 = resignTodos1.find(item => item.runId === resignRun.runId);
    expect(resignTask1).toBeTruthy();
    expect((await settleWorkflowCommand(pool, await callerFor(approver1).task.execute({ taskId: resignTask1.id, result: { decision: "approved" } }))).status).toBe("waiting");
    const resignTodos2: any[] = await callerFor(approver2).task.list({ view: "todo", projectId });
    const resignTask2 = resignTodos2.find(item => item.runId === resignRun.runId);
    expect(resignTask2).toBeTruthy();
    expect((await settleWorkflowCommand(pool, await callerFor(approver2).task.execute({ taskId: resignTask2.id, result: { decision: "approved" } }))).status).toBe("success");

    const reportId = await createWorkflow(owner, "汇报或签集成", createReportingApprovalDefinition(roleCode) as Definition);
    const reportRun: any = await settleWorkflowCommand(pool, await callerFor(employee).workflow.run({ workflowId: reportId, input: { reportTitle: "季度汇报" } }));
    const reportTodos: any[] = await callerFor(approver1).task.list({ view: "todo", projectId });
    const reportTask = reportTodos.find(item => item.runId === reportRun.runId);
    expect(reportTask).toBeTruthy();
    expect((await settleWorkflowCommand(pool, await callerFor(approver1).task.execute({ taskId: reportTask.id, result: { decision: "approved" } }))).status).toBe("success");
    const [states] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM workflow_participant_state WHERE runId IN (?,?,?)", [shortRun.runId, longRun.runId, resignRun.runId]);
    expect(Number(states[0].total)).toBeGreaterThan(0);
  }, 120_000);
});
