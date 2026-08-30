import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { assignRole, createCustomRole, deleteCustomRole, revokeRoleAssignment, updateCustomRole } from "./iam-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const roleCode = `custom_integration_${Date.now().toString(36)}`;
const actorUsername = `custom_role_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let actorId: number | undefined;
let assignmentId: string | undefined;

describe("自定义角色真实数据库生命周期", () => {
  afterAll(async () => {
    if (!pool) return;
    if (assignmentId) await pool.query("DELETE FROM role_assignment WHERE id=?", [assignmentId]);
    await pool.query("DELETE rp FROM role_permission rp JOIN iam_role r ON r.id=rp.roleId WHERE r.code=?", [roleCode]);
    await pool.query("DELETE FROM iam_role WHERE code=?", [roleCode]);
    if (actorId) {
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=?",
        [actorId, actorId]
      );
      await pool.query("DELETE FROM users WHERE id=?", [actorId]);
    }
    await pool.end();
  });

  runIntegration("绑定权限后不可直接删除，撤销授权后可安全删除", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query(
      "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW())",
      [`test:${actorUsername}`, actorUsername, "自定义角色测试管理员", "admin", "active", "internal"]
    );
    const [actors] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE username=? LIMIT 1",
      [actorUsername]
    );
    actorId = actors[0]?.id;
    expect(actorId).toBeTruthy();

    await createCustomRole({ code: roleCode, name: "集成测试角色", scope: "system", permissions: ["workflow:create"], actorUserId: actorId! });
    await updateCustomRole({ code: roleCode, name: "更新后的集成测试角色", permissions: ["workflow:create", "workflow:view"], actorUserId: actorId! });
    await assignRole({ userId: actorId!, roleCode, scopeType: "system", grantedByUserId: actorId! });
    const [assignments] = await pool.query<mysql.RowDataPacket[]>("SELECT ra.id,r.name FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId WHERE r.code=? AND ra.revokedAt IS NULL", [roleCode]);
    assignmentId = assignments[0]?.id;

    await expect(deleteCustomRole({ code: roleCode, actorUserId: actorId! })).rejects.toThrow("有效授权");
    await revokeRoleAssignment({ assignmentId: assignmentId!, revokedByUserId: actorId! });
    await deleteCustomRole({ code: roleCode, actorUserId: actorId! });
    const [roles] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM iam_role WHERE code=?", [roleCode]);
    expect(roles).toHaveLength(0);
  }, 30_000);
});
