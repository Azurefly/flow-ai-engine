import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  query: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  audit: vi.fn(),
  current: null as any,
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.pool,
    getConnection: async () => connection,
  }),
}));
vi.mock("./iam-service", () => ({
  recordAuthorizationAudit: mocks.audit,
  ensureIamCatalog: vi.fn(),
}));
import { login } from "./internal-auth";
const connection = {
  query: mocks.query,
  beginTransaction: mocks.begin,
  commit: mocks.commit,
  rollback: mocks.rollback,
  release: mocks.release,
};
const password = "Test9_login_fixture",
  salt = "fixed-fixture-salt";
const user = {
  id: 2,
  username: "fixture",
  status: "active",
  role: "user",
  tokenVersion: 1,
  passwordHash: salt + ":" + scryptSync(password, salt, 64).toString("hex"),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FLOW_BOOTSTRAP_ADMIN_USERNAME", "");
  vi.stubEnv("FLOW_BOOTSTRAP_ADMIN_PASSWORD", "");
  mocks.current = { ...user };
  mocks.pool.mockResolvedValue([[{ ...user }]]);
  mocks.query.mockImplementation(async (sql: string) =>
    sql.startsWith("SELECT")
      ? [[mocks.current].filter(Boolean)]
      : [{ affectedRows: 1 }]
  );
  mocks.audit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it.each(["disabled", "revision_changed", "password_changed", "deleted"])(
  "密码校验后遇到%s不产生新会话",
  async mode => {
    if (mode === "disabled") mocks.current.status = "disabled";
    if (mode === "revision_changed") mocks.current.tokenVersion = 3;
    if (mode === "password_changed") mocks.current.passwordHash = "changed";
    if (mode === "deleted") mocks.current = null;
    expect(await login(user.username, password)).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  }
);
it("会话、最近登录时间和成功审计使用同一连接提交", async () => {
  const result = await login(user.username, password, "x".repeat(300));
  expect(result?.user.id).toBe(user.id);
  expect(mocks.query.mock.calls[0][0]).toContain("FOR UPDATE");
  expect(mocks.query.mock.calls[1][0]).toContain("INSERT INTO auth_session");
  expect(mocks.query.mock.calls[1][1][4]).toHaveLength(255);
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "login_success" }),
    connection
  );
  expect(mocks.commit).toHaveBeenCalledOnce();
});
it("审计失败不留下已登记但未交付给用户的会话", async () => {
  mocks.audit.mockRejectedValueOnce(new Error("audit failed"));
  await expect(login(user.username, password)).rejects.toThrow("audit failed");
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledOnce();
});
