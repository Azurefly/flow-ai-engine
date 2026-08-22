import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { assignOrganizationMember, createOrganizationUnit } from "./organization-service";
import { createProject, createProjectWorkflow, grantProjectMember, setProjectWorkflowAudit } from "./project-service";
import { appRouter } from "./routers";
import { updateWorkflow, type Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
let pool: mysql.Pool | undefined;
let owner: any;
let employee: any;
let supervisor: any;
let manager: any;
let projectId: string | undefined;
let workflowId: string | undefined;
let teamUnitId: string | undefined;
let managementUnitId: string | undefined;

const leaveDefinition: Definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: { leaveReason: "{{input.leaveReason}}" } } },
    {
      id: "apply-auto",
      type: "operate",
      name: "申请操作",
      position: { x: 180, y: 0 },
      config: {
        nodeDh: "APPLY",
        czmc: "申请操作",
        assigneeMode: "receivers",
        instruction: "提交请假申请并自动补充直属上级",
        sxsz: { zdglxgfsz: ["upperAuthUnitWord"], yrdbmsfkcz: "是", xzdzlcjywc: [] },
        zdzx: { sfzdzx: "是", tjsz: [], code: [] },
      },
    },
    { id: "waiting-supervisor", type: "state", name: "等待直属上级审核", position: { x: 360, y: 0 }, config: { nodeDh: "WAIT_SUPERVISOR", jdmc: "等待审核", flowStatus: "等待审核", stateColor: "#f59e0b", stateType: "business" } },
    { id: "supervisor-approve", type: "operate", name: "直属上级审核", position: { x: 540, y: 0 }, config: { nodeDh: "SUPERVISOR_APPROVE", czmc: "审核通过", assigneeMode: "receivers", pendingStatusName: "待审批", instruction: "审核员工请假申请" } },
    { id: "supervisor-approved", type: "state", name: "直属上级已审核", position: { x: 720, y: 0 }, config: { nodeDh: "SUPERVISOR_APPROVED", jdmc: "已审核", flowStatus: "直接上级审核通过，待经理通过", stateColor: "#2563eb", stateType: "business" } },
    {
      id: "bind-manager-auto",
      type: "operate",
      name: "自动补充经理",
      position: { x: 900, y: 0 },
      config: {
        nodeDh: "BIND_MANAGER",
        czmc: "自动操作",
        assigneeMode: "receivers",
        instruction: "按当前发送方的上级权限部门自动补充经理",
        sxsz: { zdglxgfsz: ["upperAuthUnitWord"], yrdbmsfkcz: "是", xzdzlcjywc: [] },
        zdzx: { sfzdzx: "是", tjsz: [], code: [] },
      },
    },
    { id: "manager-approve", type: "operate", name: "经理审核", position: { x: 1080, y: 0 }, config: { nodeDh: "MANAGER_APPROVE", czmc: "审核通过", assigneeMode: "receivers", pendingStatusName: "待审批", instruction: "完成经理级请假审核" } },
    { id: "approved", type: "state", name: "申请通过", position: { x: 1260, y: 0 }, config: { nodeDh: "APPROVED", jdmc: "已审核", flowStatus: "申请通过", stateColor: "#16a34a", stateType: "business" } },
    { id: "end", type: "end", name: "结束", position: { x: 1440, y: 0 }, config: { resultTemplate: { status: "{{nodes.approved.flowStatus}}", leaveReason: "{{vars.leaveReason}}" } } },
  ],
  edges: [
    { id: "e1", sourceNodeId: "start", targetNodeId: "apply-auto" },
    { id: "e2", sourceNodeId: "apply-auto", targetNodeId: "waiting-supervisor" },
    { id: "e3", sourceNodeId: "waiting-supervisor", targetNodeId: "supervisor-approve" },
    { id: "e4", sourceNodeId: "supervisor-approve", targetNodeId: "supervisor-approved" },
    { id: "e5", sourceNodeId: "supervisor-approved", targetNodeId: "bind-manager-auto" },
    { id: "e6", sourceNodeId: "bind-manager-auto", targetNodeId: "manager-approve" },
    { id: "e7", sourceNodeId: "manager-approve", targetNodeId: "approved" },
    { id: "e8", sourceNodeId: "approved", targetNodeId: "end" },
  ],
};

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: { cookie: () => undefined, clearCookie: () => undefined } } as unknown as TrpcContext);
}

function findRun(rows: any[], runId: string) {
  return rows.find(row => String(row.id) === runId);
}

describe("原版人员级状态模型：员工请假、直属上级和经理逐级审核", () => {
  afterAll(async () => {
    if (!pool) return;
    if (workflowId) {
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_task WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_participant_state WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_run WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    if (projectId) {
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    if (teamUnitId || managementUnitId) {
      const unitIds = [teamUnitId, managementUnitId].filter(Boolean);
      await pool.query("DELETE FROM organization_membership WHERE unitId IN (?)", [unitIds]);
      if (teamUnitId) await pool.query("DELETE FROM organization_unit WHERE id=?", [teamUnitId]);
      if (managementUnitId) await pool.query("DELETE FROM organization_unit WHERE id=?", [managementUnitId]);
    }
    const userIds = [owner?.id, employee?.id, supervisor?.id, manager?.id].filter(Boolean);
    if (userIds.length) await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)", [userIds, userIds]);
    await pool.query("DELETE FROM users WHERE username IN (?,?,?,?)", [`leave_owner_${suffix}`, `leave_employee_${suffix}`, `leave_supervisor_${suffix}`, `leave_manager_${suffix}`]);
    await pool.end();
  });

  runIntegration("自动补员、人员状态、可执行操作和两级待办完整流转并持久化", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES ?", [[
      [`test:leave-owner-${suffix}`, `leave_owner_${suffix}`, "流程管理员", "admin", "active", "internal", new Date()],
      [`test:leave-employee-${suffix}`, `leave_employee_${suffix}`, "请假员工", "user", "active", "internal", new Date()],
      [`test:leave-supervisor-${suffix}`, `leave_supervisor_${suffix}`, "直属上级", "user", "active", "internal", new Date()],
      [`test:leave-manager-${suffix}`, `leave_manager_${suffix}`, "部门经理", "user", "active", "internal", new Date()],
    ]]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?,?,?)", [`leave_owner_${suffix}`, `leave_employee_${suffix}`, `leave_supervisor_${suffix}`, `leave_manager_${suffix}`]);
    owner = users.find(user => user.username === `leave_owner_${suffix}`);
    employee = users.find(user => user.username === `leave_employee_${suffix}`);
    supervisor = users.find(user => user.username === `leave_supervisor_${suffix}`);
    manager = users.find(user => user.username === `leave_manager_${suffix}`);

    managementUnitId = await createOrganizationUnit(owner, { code: `MGT_${suffix.toUpperCase()}`, name: "管理部", managerUserId: manager.id });
    teamUnitId = await createOrganizationUnit(owner, { code: `TEAM_${suffix.toUpperCase()}`, name: "研发组", parentUnitId: managementUnitId, managerUserId: supervisor.id });
    await assignOrganizationMember(owner, { unitId: teamUnitId, userId: employee.id, title: "员工", isPrimary: true });
    await assignOrganizationMember(owner, { unitId: teamUnitId, userId: supervisor.id, title: "直属上级", isPrimary: true });
    await assignOrganizationMember(owner, { unitId: managementUnitId, userId: manager.id, title: "经理", isPrimary: true });

    projectId = await createProject(owner, { code: `LV${suffix.slice(0, 6).toUpperCase()}`, name: "请假状态流验收" });
    await grantProjectMember(owner, { projectId, userId: employee.id, role: "operator" });
    await grantProjectMember(owner, { projectId, userId: supervisor.id, role: "operator" });
    await grantProjectMember(owner, { projectId, userId: manager.id, role: "operator" });
    const workflow = await createProjectWorkflow(owner, { projectId, name: "员工请假流程", flowType: "state", definition: leaveDefinition });
    workflowId = workflow.id;
    await setProjectWorkflowAudit(owner, { projectId, workflowId, auditStatus: "approved" });
    await updateWorkflow(workflowId, owner, { publish: true });

    const started: any = await callerFor(employee).workflow.run({ workflowId, input: { leaveReason: "家庭事务" } });
    expect(started.status).toBe("waiting");

    const employeeTodo = await callerFor(employee).task.list({ view: "todo", projectId });
    expect(employeeTodo).toHaveLength(0);
    const supervisorTodo: any[] = await callerFor(supervisor).task.list({ view: "todo", projectId });
    expect(supervisorTodo).toHaveLength(1);
    expect(supervisorTodo[0]).toMatchObject({ id: started.taskId, operationName: "审核通过", displayStatus: "待审批", assignedUserId: supervisor.id });

    const employeeWaiting = findRun(await callerFor(employee).task.instances({ view: "initiated" }), started.runId);
    expect(employeeWaiting).toMatchObject({ displayStatus: "等待审核", availableOperations: [] });
    const supervisorWaiting = findRun(await callerFor(supervisor).task.instances({ view: "all" }), started.runId);
    expect(supervisorWaiting).toMatchObject({ displayStatus: "待审批" });
    expect(supervisorWaiting.availableOperations).toEqual([{ taskId: started.taskId, name: "审核通过" }]);

    const supervisorResult: any = await callerFor(supervisor).task.execute({ taskId: started.taskId, result: { decision: "approved", comment: "同意" } });
    expect(supervisorResult.status).toBe("waiting");
    const supervisorDone: any[] = await callerFor(supervisor).task.list({ view: "done", projectId });
    expect(supervisorDone[0]).toMatchObject({ id: started.taskId, displayStatus: "已审核", completedByUserId: supervisor.id });
    const supervisorApproved = findRun(await callerFor(supervisor).task.instances({ view: "all" }), started.runId);
    expect(supervisorApproved).toMatchObject({ displayStatus: "已审核", availableOperations: [] });
    const employeeManagerWaiting = findRun(await callerFor(employee).task.instances({ view: "initiated" }), started.runId);
    expect(employeeManagerWaiting).toMatchObject({ displayStatus: "直接上级审核通过，待经理通过", availableOperations: [] });

    const managerTodo: any[] = await callerFor(manager).task.list({ view: "todo", projectId });
    expect(managerTodo).toHaveLength(1);
    expect(managerTodo[0]).toMatchObject({ id: supervisorResult.taskId, operationName: "审核通过", displayStatus: "待审批", assignedUserId: manager.id });
    const managerResult: any = await callerFor(manager).task.execute({ taskId: supervisorResult.taskId, result: { decision: "approved", comment: "批准" } });
    expect(managerResult.status).toBe("success");

    const managerDone: any[] = await callerFor(manager).task.list({ view: "done", projectId });
    expect(managerDone[0]).toMatchObject({ id: supervisorResult.taskId, displayStatus: "已审核", completedByUserId: manager.id });
    const managerApproved = findRun(await callerFor(manager).task.instances({ view: "all" }), started.runId);
    expect(managerApproved).toMatchObject({ displayStatus: "已审核", availableOperations: [] });
    const employeeApproved = findRun(await callerFor(employee).task.instances({ view: "initiated" }), started.runId);
    expect(employeeApproved).toMatchObject({ displayStatus: "申请通过", availableOperations: [] });

    const observer = await mysql.createConnection(process.env.DATABASE_URL!);
    const [persisted] = await observer.query<mysql.RowDataPacket[]>("SELECT userId,stateName,flowStatus,availableOperationsJson FROM workflow_participant_state WHERE runId=? ORDER BY userId", [started.runId]);
    await observer.end();
    expect(persisted).toHaveLength(3);
    expect(persisted.find(row => Number(row.userId) === employee.id)).toMatchObject({ stateName: "申请通过", flowStatus: "申请通过" });
    expect(persisted.find(row => Number(row.userId) === supervisor.id)).toMatchObject({ stateName: "已审核" });
    expect(persisted.find(row => Number(row.userId) === manager.id)).toMatchObject({ stateName: "已审核" });
  }, 120_000);
});