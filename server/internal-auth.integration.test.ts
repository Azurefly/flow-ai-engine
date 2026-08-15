import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { createUser, login, logout, setUserStatus } from "./internal-auth";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const username = `audit_test_${randomUUID().slice(0, 8)}`;
let pool: mysql.Pool | undefined;
let userId: number | undefined;

describe("内部认证授权审计", () => {
  afterAll(async () => {
    if (!pool) return;
    if (userId) {
      await pool.query("DELETE FROM auth_session WHERE userId=?", [userId]);
      await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=?", [userId, userId]);
      await pool.query("DELETE FROM users WHERE id=?", [userId]);
    }
    await pool.query("DELETE FROM authorization_audit_log WHERE resourceType='auth' AND JSON_UNQUOTE(JSON_EXTRACT(detailsJson,'$.username'))=?", [username]);
    await pool.end();
  });

  runIntegration("登录、登出和禁用后失败登录均产生审计事件", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    userId = await createUser({ username, password: "integration-password-2026", name: "认证审计测试" });
    const signedIn = await login(username, "integration-password-2026", "vitest-agent");
    expect(signedIn?.user.id).toBe(userId);
    await logout(signedIn?.token, userId);
    await setUserStatus(userId, "disabled");
    await expect(login(username, "integration-password-2026", "vitest-agent")).resolves.toBeNull();
    const caller = appRouter.createCaller({ user: null, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
    await expect(caller.auth.login({ username, password: "integration-password-2026" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const [events] = await pool.query<mysql.RowDataPacket[]>("SELECT action FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=? OR JSON_UNQUOTE(JSON_EXTRACT(detailsJson,'$.username'))=? ORDER BY createdAt", [userId, userId, username]);
    expect(events.map(event => event.action)).toEqual(expect.arrayContaining(["login_success", "logout", "login_failed"]));
  }, 30_000);
});
