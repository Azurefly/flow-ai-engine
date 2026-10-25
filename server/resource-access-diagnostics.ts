import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  assignedPermissionSources,
  ensureIamCatalog,
  getWorkflowAccess,
  hasSystemPermission,
  listPermissionCatalog,
  memberRolePermissions,
  projectMemberWorkflowPermissions,
  type WorkflowPermission,
} from "./iam-service";
import {
  getProjectAccess,
  rolePermissions as projectPermissions,
  type ProjectUser,
} from "./project-service";
import { inspectWorkflowTaskAction } from "./p1-service";

const windowState = (alias: string, revoked = true) =>
  `CASE ${revoked ? `WHEN ${alias}.revokedAt IS NOT NULL THEN '已撤销'` : ""} WHEN ${alias}.effectiveFrom>NOW() THEN '未生效' WHEN ${alias}.expiresAt IS NOT NULL AND ${alias}.expiresAt<=NOW() THEN '已过期' ELSE '有效' END`;
const roleLabel = (role: string) =>
  (
    ({
      owner: "所有者",
      designer: "设计者",
      editor: "编辑者",
      operator: "运行者",
      viewer: "查看者",
    }) as Record<string, string>
  )[role] || role;

/** Authorization decisions come from the same readers used by actual APIs. The remaining SQL explains provenance only. */
export async function diagnoseResourceAccess(
  actor: ProjectUser,
  input: { userId: number; workflowId: string; taskId?: string }
) {
  if (!(await hasSystemPermission(actor, "iam:manage")))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "无权诊断其他用户的资源权限。",
    });
  await ensureIamCatalog();
  const connection = await getSharedPool().getConnection();
  let target: ProjectUser | undefined;
  let snapshot;
  try {
    await connection.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
    );
    await connection.beginTransaction();
    const [users] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,username,name,role,status FROM users WHERE id=? LIMIT 1",
      [input.userId]
    );
    const [resources] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT w.id,w.name,w.flowType,w.status,w.archivedAt,w.ownerUserId,w.projectId,p.name AS projectName,p.ownerUserId AS projectOwnerUserId,p.status AS projectStatus FROM workflow w LEFT JOIN flow_project p ON p.id=w.projectId WHERE w.id=? LIMIT 1",
      [input.workflowId]
    );
    const user = users[0],
      resource = resources[0];
    if (!user || !resource)
      throw new TRPCError({ code: "NOT_FOUND", message: "用户或流程不存在。" });
    target = {
      id: Number(user.id),
      role: user.role === "admin" ? "admin" : "user",
    };
    const active = user.status === "active";
    const access = await getWorkflowAccess(target, input.workflowId, {
      connection,
    });
    const project = resource.projectId
      ? await getProjectAccess(target, String(resource.projectId), {
          connection,
          includeArchived: true,
        })
      : null;
    const assigned = active
      ? await assignedPermissionSources(target.id, input.workflowId, connection)
      : [];
    const [roles] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT '直接角色' AS kind,r.name AS roleName,r.code AS roleCode,ra.scopeType AS scopeLabel,${windowState("ra")} AS state,ra.expiresAt FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId WHERE ra.userId=? AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=?))`,
      [target.id, input.workflowId]
    );
    const [members] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT '流程成员' AS kind,wm.role AS roleName,${windowState("wm")} AS state,wm.expiresAt FROM workflow_member wm WHERE wm.userId=? AND wm.workflowId=?`,
      [target.id, input.workflowId]
    );
    const [projectMembers] = resource.projectId
      ? await connection.query<mysql.RowDataPacket[]>(
          `SELECT '业务成员' AS kind,pm.role AS roleName,${windowState("pm")} AS state,pm.expiresAt FROM flow_project_member pm WHERE pm.userId=? AND pm.projectId=?`,
          [target.id, resource.projectId]
        )
      : [[]];
    const [projectUnits] = resource.projectId
      ? await connection.query<mysql.RowDataPacket[]>(
          `SELECT '业务部门' AS kind,pu.role AS roleName,ou.name AS unitName,CASE WHEN ou.status='active' THEN '有效' ELSE '部门停用' END AS state,NULL AS expiresAt FROM flow_project_unit pu JOIN organization_membership om ON om.unitId=pu.unitId JOIN organization_unit ou ON ou.id=pu.unitId WHERE om.userId=? AND pu.projectId=?`,
          [target.id, resource.projectId]
        )
      : [[]];
    const [organization] = await connection.query<mysql.RowDataPacket[]>(
      `WITH RECURSIVE membership_units AS (
      SELECT ou.id AS memberUnitId,ou.id AS unitId,ou.parentUnitId,0 AS depth FROM organization_membership om JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active' WHERE om.userId=?
      UNION ALL SELECT mu.memberUnitId,parent.id,parent.parentUnitId,mu.depth+1 FROM membership_units mu JOIN organization_unit parent ON parent.id=mu.parentUnitId AND parent.status='active' WHERE mu.depth<32
    ) SELECT DISTINCT '组织继承' AS kind,r.name AS roleName,r.code AS roleCode,ou.name AS unitName,${windowState("our", false)} AS state,our.expiresAt FROM membership_units mu JOIN organization_unit_role our ON our.unitId=mu.unitId JOIN organization_unit ou ON ou.id=our.unitId JOIN iam_role r ON r.id=our.roleId WHERE mu.unitId=mu.memberUnitId OR our.includeDescendants=1`,
      [target.id]
    );
    const checks = listPermissionCatalog()
      .filter(p => p.workflowAllowed && p.code !== "workflow:create")
      .map(permission => {
        const code = permission.code as WorkflowPermission;
        const dataRun = resource.flowType === "data" && code === "workflow:run";
        const allowed =
          active &&
          (dataRun
            ? Boolean(project?.permissions.has("project:workflow:run"))
            : access.permissions.has(code));
        const sources: string[] = [];
        if (allowed) {
          if (target!.role === "admin") sources.push("管理员内置权限");
          else {
            if (!dataRun && Number(resource.ownerUserId) === target!.id)
              sources.push("流程所有者");
            if (Number(resource.projectOwnerUserId) === target!.id)
              sources.push("业务所有者");
            if (!dataRun) {
              for (const row of assigned.filter(row => row.code === code))
                sources.push(
                  `${row.sourceKind === "organization" ? `组织继承：${row.unitName || "部门"}` : "直接角色"} · ${row.roleName || row.roleCode}`
                );
              for (const row of members.filter(row => row.state === "有效"))
                if (
                  memberRolePermissions[
                    row.roleName as keyof typeof memberRolePermissions
                  ]?.includes(code)
                )
                  sources.push(`流程成员 · ${roleLabel(row.roleName)}`);
            }
            for (const row of [...projectMembers, ...projectUnits].filter(
              row => row.state === "有效"
            )) {
              const matches = dataRun
                ? projectPermissions[
                    row.roleName as keyof typeof projectPermissions
                  ]?.includes("project:workflow:run")
                : projectMemberWorkflowPermissions[
                    row.roleName as keyof typeof projectMemberWorkflowPermissions
                  ]?.includes(code);
              if (matches)
                sources.push(
                  `${row.kind}${row.unitName ? `：${row.unitName}` : ""} · ${roleLabel(row.roleName)}`
                );
            }
          }
        }
        return {
          code,
          name: permission.name,
          allowed,
          sources: Array.from(new Set(sources)),
          reason: !active
            ? "账号停用，授权当前不生效。"
            : !allowed
              ? dataRun
                ? "数据流程发起需要业务运行权限。"
                : "当前没有授予此操作的有效来源。"
              : "",
        };
      });
    snapshot = {
      user: {
        id: target.id,
        name: user.name || user.username,
        status: user.status,
      },
      resource,
      checks,
      bindings: [
        ...roles,
        ...organization,
        ...members,
        ...projectMembers,
        ...projectUnits,
      ].map(row => ({
        kind: String(row.kind),
        roleName: roleLabel(row.roleName),
        state: String(row.state),
        unitName: row.unitName ? String(row.unitName) : null,
        expiresAt: (row.expiresAt ?? null) as Date | null,
        scopeLabel: row.scopeLabel ? String(row.scopeLabel) : null,
      })),
      checkedAt: new Date(),
    };
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    throw error;
  } finally {
    connection.release();
  }
  const task = input.taskId
    ? snapshot.user.status !== "active"
      ? { id: input.taskId, canAct: false, reason: "账号停用，不能办理任务。" }
      : await inspectWorkflowTaskAction(target!, input.taskId, input.workflowId)
    : null;
  return { ...snapshot, task };
}
