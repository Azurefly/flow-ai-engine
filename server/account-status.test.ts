import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  permission: vi.fn(),
  audit: vi.fn(),
  rows: [] as any[],
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: async () => connection }),
}));
vi.mock("./iam-service", () => ({
  ensureIamCatalog: vi.fn(),
  hasSystemPermission: mocks.permission,
  recordAuthorizationAudit: mocks.audit,
}));
import { changeAccountStatus } from "./account-status";
const connection = {
  query: mocks.query,
  beginTransaction: mocks.begin,
  commit: mocks.commit,
  rollback: mocks.rollback,
  release: mocks.release,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [
    { id: 1, role: "admin", status: "active", tokenVersion: 1 },
    { id: 2, role: "user", status: "active", tokenVersion: 1 },
    { id: 3, role: "admin", status: "active", tokenVersion: 1 },
  ];
  mocks.permission.mockResolvedValue(true);
  mocks.audit.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) =>
    sql.startsWith("SELECT")
      ? [mocks.rows]
      : [{ affectedRows: sql.startsWith("UPDATE auth_session") ? 2 : 1 }]
  );
});
const input = {
  userId: 2,
  status: "disabled" as const,
  actorUserId: 1,
  expectedStatus: "active" as const,
  expectedVersion: 1,
};
it("状态版本、会话撤销和审计在同一事务提交，锁定所有管理员与参与账号", async () => {
  expect(await changeAccountStatus(input)).toMatchObject({
    changed: true,
    statusVersion: 2,
    revokedSessions: 2,
  });
  expect(mocks.query.mock.calls[0][0]).toContain(
    "role='admin' OR id IN (?,?) ORDER BY id FOR UPDATE"
  );
  expect(mocks.query.mock.calls[1][0]).toContain("tokenVersion=tokenVersion+1");
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({
        previousStatus: "active",
        previousVersion: 1,
        statusVersion: 2,
        revokedSessions: 2,
      }),
    }),
    connection
  );
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.permission).toHaveBeenCalledWith(
    { id: 1, role: "admin" },
    "iam:manage",
    connection
  );
  expect(mocks.rollback).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("禁止停用当前账号，包括通过角色授权的普通身份管理员", async () => {
  await expect(
    changeAccountStatus({ ...input, actorUserId: 2 })
  ).rejects.toThrow("当前登录账号");
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledOnce();
});
it("委派身份管理员不能停用最后一位启用的管理员账号", async () => {
  mocks.rows = [
    { id: 1, role: "user", status: "active", tokenVersion: 1 },
    { id: 2, role: "admin", status: "active", tokenVersion: 1 },
    { id: 3, role: "admin", status: "disabled", tokenVersion: 4 },
  ];
  await expect(changeAccountStatus(input)).rejects.toThrow("至少一位启用");
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("旧状态和启停往返后的旧版本均拒绝，不覆盖最新状态", async () => {
  mocks.rows[1].status = "disabled";
  await expect(changeAccountStatus(input)).rejects.toThrow("状态已变化");
  mocks.rows[1].status = "active";
  mocks.rows[1].tokenVersion = 3;
  await expect(changeAccountStatus(input)).rejects.toThrow("状态已变化");
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("审计失败回滚状态与会话，不返回修改成功", async () => {
  mocks.audit.mockRejectedValueOnce(new Error("audit failed"));
  await expect(changeAccountStatus(input)).rejects.toThrow("audit failed");
  expect(mocks.query).toHaveBeenCalledTimes(3);
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledOnce();
});
it("启用账号增加版本，但不复活或重新生成会话", async () => {
  mocks.rows[1].status = "disabled";
  await changeAccountStatus({
    ...input,
    status: "active",
    expectedStatus: "disabled",
  });
  expect(
    mocks.query.mock.calls.some(call => call[0].includes("auth_session"))
  ).toBe(false);
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "user_updated" }),
    connection
  );
});
it.each(["disabled", "permission_revoked"])(
  "锁内复核操作账号的%s状态",
  async mode => {
    if (mode === "disabled") mocks.rows[0].status = "disabled";
    else mocks.permission.mockResolvedValue(false);
    await expect(changeAccountStatus(input)).rejects.toThrow("无权变更");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  }
);
it("不存在的账号和版本溢出不产生状态修改", async () => {
  mocks.rows = [mocks.rows[0]];
  await expect(changeAccountStatus(input)).rejects.toThrow("不存在");
  mocks.rows.push({
    id: 2,
    role: "user",
    status: "active",
    tokenVersion: 2147483647,
  });
  await expect(changeAccountStatus(input)).rejects.toThrow("版本无效");
  expect(mocks.audit).not.toHaveBeenCalled();
});
