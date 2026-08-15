import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { authenticateToken, ensureBootstrapAdmin, FLOW_SESSION_COOKIE, login } from "./internal-auth";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const username = `session_test_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let userId: number | undefined;

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https", cookie: `${FLOW_SESSION_COOKIE}=test` }, res: {} } as unknown as TrpcContext);
}

describe("管理员引导与失效会话", () => {
  afterAll(async () => {
    if (!pool) return;
    if (userId) {
      await pool.query("DELETE FROM auth_session WHERE userId=?", [userId]);
      await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=?", [userId, userId]);
      await pool.query("DELETE FROM users WHERE id=?", [userId]);
    }
    await pool.end();
  });

  runIntegration("管理员引导存在，管理员创建账号后禁用会撤销已有会话并写入审计", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await ensureBootstrapAdmin();
    const [admins] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1");
    const admin = admins[0];
    expect(admin).toBeTruthy();

    const adminCaller = callerFor(admin);
    await adminCaller.iam.createUser({ username, password: "session-test-password-2026", name: "会话失效测试", role: "user" });
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username=? LIMIT 1", [username]);
    userId = users[0]?.id;
    const signedIn = await login(username, "session-test-password-2026", "vitest-agent");
    expect(await authenticateToken(signedIn?.token)).toMatchObject({ id: userId });
    await adminCaller.iam.updateUserStatus({ userId: userId!, status: "disabled" });
    expect(await authenticateToken(signedIn?.token)).toBeNull();
    const [audit] = await pool.query<mysql.RowDataPacket[]>("SELECT action FROM authorization_audit_log WHERE targetUserId=? ORDER BY createdAt", [userId]);
    expect(audit.map(row => row.action)).toEqual(expect.arrayContaining(["user_created", "user_disabled"]));
  }, 45_000);
});
