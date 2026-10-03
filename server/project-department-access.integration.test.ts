import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, expect, it } from "vitest";
import { appRouter } from "./routers";
import { getProjectAccess, listProjects } from "./project-service";
import { getWorkflowAccess } from "./iam-service";
import { listWorkflows } from "./workflow-service";

const run = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
let pool: mysql.Pool;
let projectId: string;
let workflowId: string;
const unitIds: string[] = [];
const userIds: number[] = [];
const callerFor = (user: any) =>
  appRouter.createCaller({
    user,
    req: { headers: {}, protocol: "http" },
    res: {},
  } as any);

afterAll(async () => {
  if (!pool) return;
  if (workflowId) {
    await pool.query("DELETE FROM workflow_version WHERE workflowId=?", [
      workflowId,
    ]);
    await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [
      workflowId,
    ]);
    await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
  }
  if (projectId) {
    await pool.query("DELETE FROM flow_project_unit WHERE projectId=?", [
      projectId,
    ]);
    await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [
      projectId,
    ]);
    await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
  }
  if (unitIds.length) {
    await pool.query(
      "DELETE FROM organization_membership WHERE unitId IN (?)",
      [unitIds]
    );
    await pool.query("DELETE FROM organization_unit WHERE id IN (?)", [
      unitIds,
    ]);
  }
  if (userIds.length) {
    await pool.query(
      "DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)",
      [userIds, userIds]
    );
    await pool.query("DELETE FROM users WHERE id IN (?)", [userIds]);
  }
  await pool.end();
});

run(
  "多部门与直接角色共同生效，项目与流程权限一致，撤销及停用即时失效",
  async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    for (const role of ["admin", "user"] as const) {
      const username = `dept_access_${role}_${suffix}`;
      const [result] = await pool.query<mysql.ResultSetHeader>(
        "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,'active','internal',NOW())",
        [`test:${username}`, username, username, role]
      );
      userIds.push(result.insertId);
    }
    const admin = { id: userIds[0], role: "admin" as const };
    const employee = { id: userIds[1], role: "user" as const };
    const owner = callerFor(admin);
    const staff = callerFor(employee);
    projectId = (
      await owner.project.create({
        code: `DA_${suffix}`,
        name: "部门项目权限联动验收",
      })
    ).id;
    workflowId = (
      await owner.project.createWorkflow({
        projectId,
        name: "部门授权流程",
        flowType: "control",
      })
    ).id;
    for (const role of ["viewer", "operator", "designer"] as const) {
      const unitId = (
        await owner.config.createOrganizationUnit({
          code: `DA_${role}_${suffix}`,
          name: `验收${role}`,
        })
      ).id;
      unitIds.push(unitId);
      await owner.config.assignOrganizationMember({
        unitId,
        userId: employee.id,
      });
      await owner.project.grantUnit({ projectId, unitId, role });
    }
    await owner.project.grantMember({
      projectId,
      userId: employee.id,
      role: "viewer",
    });
    expect((await getProjectAccess(employee, projectId)).roles.sort()).toEqual([
      "designer",
      "operator",
      "viewer",
    ]);
    const access = await getWorkflowAccess(employee, workflowId);
    expect(access.projectRoles.sort()).toEqual([
      "designer",
      "operator",
      "viewer",
    ]);
    expect(access.permissions.has("workflow:run")).toBe(true);
    expect(access.permissions.has("workflow:edit")).toBe(true);
    expect(access.permissions.has("workflow:members:manage")).toBe(false);
    await staff.workflow.update({ id: workflowId, name: "部门设计者可编辑" });
    await owner.project.revokeMember({ projectId, userId: employee.id });
    expect(
      (await getWorkflowAccess(employee, workflowId)).permissions.has(
        "workflow:edit"
      )
    ).toBe(true);
    await owner.config.updateOrganizationUnit({
      id: unitIds[2],
      status: "disabled",
    });
    expect(
      (await getWorkflowAccess(employee, workflowId)).permissions.has(
        "workflow:edit"
      )
    ).toBe(false);
    await expect(
      staff.workflow.update({ id: workflowId, name: "停用后不可编辑" })
    ).rejects.toThrow();
    expect(
      (await getWorkflowAccess(employee, workflowId)).permissions.has(
        "workflow:run"
      )
    ).toBe(true);
    await owner.project.revokeUnit({ projectId, unitId: unitIds[1] });
    expect(
      (await getWorkflowAccess(employee, workflowId)).permissions.has(
        "workflow:run"
      )
    ).toBe(false);
    expect(
      (await getWorkflowAccess(employee, workflowId)).permissions.has(
        "workflow:view"
      )
    ).toBe(true);
    await owner.config.updateOrganizationUnit({
      id: unitIds[0],
      status: "disabled",
    });
    expect((await getProjectAccess(employee, projectId)).permissions.size).toBe(
      0
    );
    expect(
      (await getWorkflowAccess(employee, workflowId)).permissions.size
    ).toBe(0);
    expect(
      (await listProjects(employee)).some(project => project.id === projectId)
    ).toBe(false);
    expect(
      (await listWorkflows(employee)).some(
        workflow => workflow.id === workflowId
      )
    ).toBe(false);
  },
  30_000
);
