import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ensureIamCatalog, hasSystemPermission } from "./iam-service";
import {
  resolveRoleCandidateUserIds,
  resolveWorkflowUserRoleKeys,
} from "./organization-service";
import { appRouter } from "./routers";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
let pool: mysql.Pool | undefined;
let admin: any;
let employee: any;
let unitId: string | undefined;
let secondaryUnitId: string | undefined;
let childUnitId: string | undefined;

describe("BDP 参考式组织字段与部门权限组继承", () => {
  afterAll(async () => {
    if (!pool) return;
    const unitIds = [unitId, secondaryUnitId, childUnitId].filter(Boolean);
    if (unitIds.length) {
      await pool.query(
        "DELETE FROM organization_unit_role WHERE unitId IN (?)",
        [unitIds]
      );
      await pool.query(
        "DELETE FROM organization_membership WHERE unitId IN (?)",
        [unitIds]
      );
      await pool.query(
        "UPDATE organization_unit SET parentUnitId=NULL WHERE id IN (?)",
        [unitIds]
      );
      await pool.query("DELETE FROM organization_unit WHERE id IN (?)", [
        unitIds,
      ]);
    }
    const ids = [admin?.id, employee?.id].filter(Boolean);
    if (ids.length)
      await pool.query("DELETE FROM role_assignment WHERE userId IN (?)", [
        ids,
      ]);
    if (ids.length)
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)",
        [ids, ids]
      );
    await pool.query("DELETE FROM users WHERE username IN (?,?)", [
      `org_admin_${suffix}`,
      `org_employee_${suffix}`,
    ]);
    await pool.end();
  });

  runIntegration(
    "扩展机构字段持久化，绑定权限即时继承且解绑即时失效",
    async () => {
      pool = mysql.createPool(process.env.DATABASE_URL!);
      await ensureIamCatalog();
      await pool.query(
        "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES ?",
        [
          [
            [
              `test:org-admin-${suffix}`,
              `org_admin_${suffix}`,
              "组织管理员",
              "admin",
              "active",
              "internal",
              new Date(),
            ],
            [
              `test:org-employee-${suffix}`,
              `org_employee_${suffix}`,
              "组织员工",
              "user",
              "active",
              "internal",
              new Date(),
            ],
          ],
        ]
      );
      const [userRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT * FROM users WHERE username IN (?,?)",
        [`org_admin_${suffix}`, `org_employee_${suffix}`]
      );
      admin = userRows.find(row => row.username === `org_admin_${suffix}`);
      employee = userRows.find(
        row => row.username === `org_employee_${suffix}`
      );
      const caller = appRouter.createCaller({
        user: admin,
        req: { headers: {}, protocol: "https" },
        res: { cookie: () => undefined, clearCookie: () => undefined },
      } as unknown as TrpcContext);

      unitId = (
        await caller.config.createOrganizationUnit({
          code: `ORG_${suffix.toUpperCase()}`,
          name: "研发中心",
          managerUserId: admin.id,
          unitType: "department",
          unitLevel: 2,
          standardCode: `STD-${suffix}`,
          areaCode: "440300",
          category: "technology",
          sortOrder: 20,
          description: "用于组织权限继承集成测试",
        })
      ).id;
      secondaryUnitId = (
        await caller.config.createOrganizationUnit({
          code: `ORG_B_${suffix.toUpperCase()}`,
          name: "交付中心",
          managerUserId: admin.id,
          unitType: "department",
        })
      ).id;
      await caller.config.assignOrganizationMember({
        unitId,
        userId: employee.id,
        title: "开发工程师",
        isPrimary: true,
      });
      await caller.config.assignOrganizationMember({
        unitId: secondaryUnitId,
        userId: employee.id,
        title: "兼任工程师",
        isPrimary: false,
      });
      await caller.config.setPrimaryOrganizationMembership({
        unitId: secondaryUnitId,
        userId: employee.id,
      });
      let organization: any = await caller.config.organization();
      expect(
        organization.members.find(
          (member: any) =>
            member.unitId === secondaryUnitId &&
            Number(member.userId) === employee.id
        )
      ).toMatchObject({ isPrimary: 1 });
      expect(
        organization.members.find(
          (member: any) =>
            member.unitId === unitId && Number(member.userId) === employee.id
        )
      ).toMatchObject({ isPrimary: 0 });
      await caller.config.moveOrganizationMember({
        fromUnitId: secondaryUnitId,
        toUnitId: unitId,
        userId: employee.id,
        title: "平台工程师",
        makePrimary: true,
      });
      const [roleRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id FROM iam_role WHERE code='workflow_creator' LIMIT 1"
      );
      const roleId = Number(roleRows[0].id);
      await caller.config.bindOrganizationRole({ unitId, roleId });
      await pool.query(
        "INSERT INTO role_assignment (id,userId,roleId,scopeType,effectiveFrom,grantedByUserId,note) VALUES (?,?,?,'system',NOW(),?,?)",
        [
          randomUUID(),
          employee.id,
          roleId,
          admin.id,
          "验证直接角色与部门继承角色区分",
        ]
      );

      organization = await caller.config.organization();
      expect(
        organization.units.find((unit: any) => unit.id === unitId)
      ).toMatchObject({
        unitType: "department",
        unitLevel: 2,
        standardCode: `STD-${suffix}`,
        areaCode: "440300",
        category: "technology",
        sortOrder: 20,
        description: "用于组织权限继承集成测试",
      });
      const employeeMembership = organization.members.find(
        (member: any) =>
          member.unitId === unitId && Number(member.userId) === employee.id
      );
      expect(employeeMembership).toMatchObject({
        title: "平台工程师",
        isPrimary: 1,
      });
      expect(
        organization.members.some(
          (member: any) =>
            member.unitId === secondaryUnitId &&
            Number(member.userId) === employee.id
        )
      ).toBe(false);
      expect(employeeMembership.directRoles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ roleCode: "workflow_creator" }),
        ])
      );
      expect(employeeMembership.inheritedRoles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            unitId,
            roleCode: "workflow_creator",
          }),
        ])
      );
      expect(
        organization.roleBindings.find(
          (binding: any) => binding.unitId === unitId
        )
      ).toMatchObject({ roleId, roleCode: "workflow_creator" });
      expect(await hasSystemPermission(employee, "workflow:create")).toBe(true);
      expect(
        await resolveRoleCandidateUserIds("workflow_creator", randomUUID())
      ).toContain(employee.id);
      expect(
        await resolveWorkflowUserRoleKeys([employee.id], randomUUID())
      ).toEqual(
        new Map([
          [employee.id, ["default", "workflow_creator", String(roleId)]],
        ])
      );
      await pool.query(
        "DELETE FROM role_assignment WHERE userId=? AND roleId=? AND scopeType='system'",
        [employee.id, roleId]
      );

      await expect(
        caller.config.bindOrganizationRole({
          unitId,
          roleId: Number(
            (
              await pool.query<mysql.RowDataPacket[]>(
                "SELECT id FROM iam_role WHERE code='system_admin' LIMIT 1"
              )
            )[0][0].id
          ),
        })
      ).rejects.toThrow("非系统管理员");
      childUnitId = (
        await caller.config.createOrganizationUnit({
          code: `ORG_C_${suffix.toUpperCase()}`,
          name: "研发一组",
          parentUnitId: unitId,
          unitType: "department",
        })
      ).id;
      await caller.config.moveOrganizationMember({
        fromUnitId: unitId,
        toUnitId: childUnitId,
        userId: employee.id,
        makePrimary: true,
      });
      expect(await hasSystemPermission(employee, "workflow:create")).toBe(true);
      await caller.config.bindOrganizationRole({
        unitId,
        roleId,
        includeDescendants: false,
      });
      expect(await hasSystemPermission(employee, "workflow:create")).toBe(false);
      await caller.config.bindOrganizationRole({
        unitId,
        roleId,
        includeDescendants: true,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(await hasSystemPermission(employee, "workflow:create")).toBe(true);
      await caller.config.moveOrganizationMember({
        fromUnitId: childUnitId,
        toUnitId: unitId,
        userId: employee.id,
        makePrimary: true,
      });
      await expect(
        caller.config.deleteOrganizationUnit({ id: unitId })
      ).rejects.toThrow("子部门");
      await caller.config.deleteOrganizationUnit({ id: childUnitId });
      await expect(
        caller.config.deleteOrganizationUnit({ id: unitId })
      ).rejects.toThrow("成员 1 人");
      await caller.config.updateOrganizationUnit({
        id: unitId,
        name: "研发与平台中心",
        sortOrder: 10,
        description: "已更新",
      });
      expect(
        (await caller.config.organization()).units.find(
          (unit: any) => unit.id === unitId
        )
      ).toMatchObject({
        name: "研发与平台中心",
        sortOrder: 10,
        description: "已更新",
      });

      await caller.config.unbindOrganizationRole({ unitId, roleId });
      expect(await hasSystemPermission(employee, "workflow:create")).toBe(
        false
      );
      expect(
        await resolveRoleCandidateUserIds("workflow_creator", randomUUID())
      ).not.toContain(employee.id);
      await caller.config.removeOrganizationMember({
        unitId,
        userId: employee.id,
      });
      await caller.config.deleteOrganizationUnit({ id: unitId });
      await caller.config.deleteOrganizationUnit({ id: secondaryUnitId });
    },
    120_000
  );
});
