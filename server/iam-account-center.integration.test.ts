import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ensureIamCatalog } from "./iam-service";
import { appRouter } from "./routers";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8).toLowerCase();
const usernames = [`batch_${suffix}_one`, `batch_${suffix}_two`];
const roleCode = `custom_batch_${suffix}`;
let pool: mysql.Pool | undefined;
let unitId: string | undefined;
let roleId: number | undefined;
let userIds: number[] = [];

describe("AI 批量用户与内部账号权限中心真实数据库闭环", () => {
  afterAll(async () => {
    if (!pool) return;
    if (userIds.length)
      await pool.query("DELETE FROM role_assignment WHERE userId IN (?)", [
        userIds,
      ]);
    if (unitId) {
      await pool.query("DELETE FROM organization_unit_role WHERE unitId=?", [
        unitId,
      ]);
      await pool.query("DELETE FROM organization_membership WHERE unitId=?", [
        unitId,
      ]);
      await pool.query("DELETE FROM organization_unit WHERE id=?", [unitId]);
    }
    if (roleId)
      await pool.query("DELETE FROM role_permission WHERE roleId=?", [roleId]);
    if (roleId) await pool.query("DELETE FROM iam_role WHERE id=?", [roleId]);
    if (userIds.length) {
      await pool.query("DELETE FROM auth_session WHERE userId IN (?)", [
        userIds,
      ]);
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE targetUserId IN (?) OR (resourceType='iam_role' AND resourceId=?)",
        [userIds, roleCode]
      );
      await pool.query("DELETE FROM users WHERE id IN (?)", [userIds]);
    }
    await pool.end();
  });

  runIntegration(
    "批量创建逐条返回结果，用户与角色均能查看直接及组织继承权限",
    async () => {
      pool = mysql.createPool(process.env.DATABASE_URL!);
      await ensureIamCatalog();
      const [adminRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT * FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1"
      );
      const admin = adminRows[0];
      expect(admin).toBeTruthy();
      const caller = appRouter.createCaller({
        user: admin,
        req: { headers: {}, protocol: "https" },
        res: { cookie: () => undefined, clearCookie: () => undefined },
      } as unknown as TrpcContext);

      const batch = await caller.iam.createUsersBatch({
        users: [
          {
            username: usernames[0],
            password: "batch-password-2026",
            name: "批量用户一",
            role: "user",
          },
          {
            username: usernames[0],
            password: "batch-password-2026",
            name: "重复账号",
            role: "user",
          },
          {
            username: usernames[1],
            password: "batch-password-2026",
            name: "批量用户二",
            role: "user",
          },
        ],
      });
      expect(batch).toMatchObject({ created: 2, failed: 1 });
      expect(batch.results.map(result => result.success)).toEqual([
        true,
        false,
        true,
      ]);
      userIds = batch.results.flatMap(result =>
        result.userId ? [result.userId] : []
      );

      await caller.iam.createCustomRole({
        code: roleCode,
        name: "批量账号查看角色",
        description: "验证直接角色与组织继承角色双向查看",
        scope: "system",
        permissions: ["workflow:view", "workflow:run"],
      });
      const [roleRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id FROM iam_role WHERE code=? LIMIT 1",
        [roleCode]
      );
      roleId = Number(roleRows[0]?.id);
      expect(roleId).toBeTruthy();

      await caller.iam.assignSystemRole({ userId: userIds[0], roleCode });
      await expect(
        caller.iam.assignSystemRole({ userId: userIds[0], roleCode })
      ).rejects.toThrow("请勿重复绑定");
      unitId = (
        await caller.config.createOrganizationUnit({
          code: `BATCH_${suffix.toUpperCase()}`,
          name: "批量账号测试部门",
          managerUserId: admin.id,
        })
      ).id;
      await caller.config.assignOrganizationMember({
        unitId,
        userId: userIds[1],
        title: "测试成员",
        isPrimary: true,
      });
      await caller.config.bindOrganizationRole({ unitId, roleId: roleId! });

      const directUser = await caller.iam.userAuthorizationDetails({
        userId: userIds[0],
      });
      expect(
        directUser.directRoles.some((role: any) => role.roleCode === roleCode)
      ).toBe(true);
      expect(
        directUser.effectivePermissions.map(
          (permission: any) => permission.code
        )
      ).toEqual(expect.arrayContaining(["workflow:view", "workflow:run"]));

      const inheritedUser = await caller.iam.userAuthorizationDetails({
        userId: userIds[1],
      });
      expect(
        inheritedUser.inheritedRoles.some(
          (role: any) => role.roleCode === roleCode && role.unitId === unitId
        )
      ).toBe(true);

      const role = await caller.iam.roleAuthorizationDetails({
        roleId: roleId!,
      });
      expect(
        role.permissions.map((permission: any) => permission.code)
      ).toEqual(["workflow:run", "workflow:view"]);
      expect(
        role.directUsers.some(
          (account: any) => Number(account.userId) === userIds[0]
        )
      ).toBe(true);
      expect(
        role.inheritedUsers.some(
          (account: any) =>
            Number(account.userId) === userIds[1] && account.unitId === unitId
        )
      ).toBe(true);

      const assignmentId = String(
        directUser.directRoles.find((item: any) => item.roleCode === roleCode)
          ?.assignmentId
      );
      expect(assignmentId).toMatch(/[0-9a-f-]{36}/);
      await caller.iam.revokeRoleAssignment({ assignmentId });
      const revokedUser = await caller.iam.userAuthorizationDetails({
        userId: userIds[0],
      });
      expect(
        revokedUser.directRoles.some((item: any) => item.roleCode === roleCode)
      ).toBe(false);
    },
    60_000
  );
});
