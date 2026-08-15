import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { createContext, type TrpcContext } from "./_core/context";
import { authenticateToken, ensureBootstrapAdmin, FLOW_SESSION_COOKIE, login, logout } from "./internal-auth";
import { appRouter } from "./routers";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const username = `session_test_${randomUUID().slice(0, 8)}`;
const bootstrapUsername = `bootstrap_test_${randomUUID().slice(0, 8)}`;
const bootstrapPassword = "bootstrap-test-password-2026";
const originalBootstrapUsername = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const originalBootstrapPassword = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
let pool: mysql.Pool | undefined;
let userId: number | undefined;
let bootstrapId: number | undefined;

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

async function contextForToken(token?: string) {
  return createContext({
    req: { headers: { cookie: token ? `${FLOW_SESSION_COOKIE}=${token}` : "" }, protocol: "https" },
    res: {},
  } as any);
}

describe("管理员引导与失效会话", () => {
  afterAll(async () => {
    if (pool) {
      const ids = [userId, bootstrapId].filter(Boolean) as number[];
      if (ids.length) {
        await pool.query("DELETE FROM auth_session WHERE userId IN (?)", [ids]);
        await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)", [ids, ids]);
        await pool.query("DELETE FROM users WHERE id IN (?)", [ids]);
      }
      await pool.end();
    }
    if (originalBootstrapUsername === undefined) delete process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
    else process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    if (originalBootstrapPassword === undefined) delete process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
    else process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
  });

  runIntegration("严格确保 bootstrap 管理员存在，登出和禁用都会使旧会话无法访问受保护路由", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME = bootstrapUsername;
    process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD = bootstrapPassword;
    await ensureBootstrapAdmin();
    const [admins] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username=? LIMIT 1", [bootstrapUsername]);
    const admin = admins[0];
    bootstrapId = admin?.id;
    expect(admin).toMatchObject({ username: bootstrapUsername, role: "admin", status: "active", loginMethod: "internal" });

    const adminCaller = callerFor(admin);
    await adminCaller.iam.createUser({ username, password: "session-test-password-2026", name: "会话失效测试", role: "user" });
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username=? LIMIT 1", [username]);
    userId = users[0]?.id;
    const firstLogin = await login(username, "session-test-password-2026", "vitest-agent");
    expect(firstLogin).toBeTruthy();
    expect((await contextForToken(firstLogin!.token)).user).toMatchObject({ id: userId });
    await logout(firstLogin!.token, userId);
    const loggedOutContext = await contextForToken(firstLogin!.token);
    await expect(appRouter.createCaller(loggedOutContext).workflow.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const secondLogin = await login(username, "session-test-password-2026", "vitest-agent");
    expect(await authenticateToken(secondLogin?.token)).toMatchObject({ id: userId });
    await adminCaller.iam.updateUserStatus({ userId: userId!, status: "disabled" });
    expect(await authenticateToken(secondLogin?.token)).toBeNull();
    await expect(appRouter.createCaller(await contextForToken(secondLogin?.token)).workflow.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const [audit] = await pool.query<mysql.RowDataPacket[]>("SELECT action FROM authorization_audit_log WHERE targetUserId=? ORDER BY createdAt", [userId]);
    expect(audit.map(row => row.action)).toEqual(expect.arrayContaining(["user_created", "user_disabled", "logout"]));
  }, 60_000);
});
