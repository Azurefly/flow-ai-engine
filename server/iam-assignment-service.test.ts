import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  query: vi.fn(),
  access: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    getConnection: mocks.connection,
    query: mocks.query,
  }),
}));
vi.mock("./iam-service", () => ({
  ensureIamCatalog: vi.fn(),
  hasSystemPermission: mocks.access,
  recordAuthorizationAudit: mocks.audit,
}));
import { assignDirectRole, revokeDirectRole } from "./iam-assignment-service";
import { customRoleConfigToken } from "./custom-role-configuration";
const input = {
  userId: 3,
  roleCode: "custom_reader",
  scopeType: "system" as const,
  grantedByUserId: 7,
  actorTokenVersion: 1,
};
const role = {
  id: 19,
  code: "custom_reader",
  name: "reader",
  description: null,
  scope: "system",
  isSystem: 0,
  permissions: ["workflow:view"],
};
let accounts: any[],
  grant: any,
  duplicate: boolean,
  others: any[],
  currentRole: any,
  conn: any;
beforeEach(() => {
  vi.resetAllMocks();
  accounts = [
    { id: 3, status: "active", role: "user", tokenVersion: 1 },
    { id: 7, status: "active", role: "user", tokenVersion: 1 },
  ];
  grant = {
    id: "grant",
    userId: 3,
    roleId: 19,
    scopeType: "system",
    scopeId: null,
    effective: 1,
  };
  duplicate = false;
  others = [];
  currentRole = { ...role };
  mocks.access.mockResolvedValue(true);
  mocks.query.mockResolvedValue([
    [{ userId: 3, roleId: 19, scopeType: "system", code: role.code }],
  ]);
  conn = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM users WHERE")) return [accounts];
      if (sql.includes("SELECT id,code,name")) return [[currentRole]];
      if (sql.includes("SELECT permissionId")) return [[{ permissionId: 2 }]];
      if (sql.includes("SELECT code FROM permission"))
        return [[{ code: "workflow:view" }]];
      if (sql.startsWith("SELECT id FROM role_assignment"))
        return [duplicate ? [{ id: "same" }] : []];
      if (sql.startsWith("SELECT id,userId,roleId")) return [[grant]];
      if (sql.startsWith("SELECT ra.id")) return [others];
      return [{}];
    }),
  };
  mocks.connection.mockResolvedValue(conn);
});
it.each(["grant", "revoke"])("%s同连接提交审计，等待后再次复核", async mode => {
  if (mode === "grant") await assignDirectRole(input);
  else
    await revokeDirectRole({
      assignmentId: "grant",
      revokedByUserId: 7,
      actorTokenVersion: 1,
    });
  expect(mocks.access).toHaveBeenCalledTimes(2);
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({ actorUserId: 7, targetUserId: 3 }),
    conn
  );
  expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(
    conn.commit.mock.invocationCallOrder[0]
  );
  expect(conn.query.mock.calls[0][1]).toEqual([[3, 7]]);
});
it.each(["grant", "revoke"])("%s审计失败回滚且保留错误原因", async mode => {
  mocks.audit.mockRejectedValue(new Error("audit failed"));
  const action =
    mode === "grant"
      ? assignDirectRole(input)
      : revokeDirectRole({ assignmentId: "grant", revokedByUserId: 7 });
  await expect(action).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    cause: expect.objectContaining({ message: "audit failed" }),
  });
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.release).toHaveBeenCalledOnce();
});
it.each(["permission", "token", "disabled"])(
  "拒绝等待后变化的%s",
  async mode => {
    if (mode === "permission")
      mocks.access.mockResolvedValueOnce(true).mockResolvedValue(false);
    if (mode === "token") accounts[1].tokenVersion = 2;
    if (mode === "disabled") accounts[1].status = "disabled";
    await expect(assignDirectRole(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  }
);
it("重复绑定、停用目标和角色快照冲突均不提交", async () => {
  duplicate = true;
  await expect(assignDirectRole(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  duplicate = false;
  accounts[0].status = "disabled";
  await expect(assignDirectRole(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  accounts[0].status = "active";
  await expect(
    assignDirectRole({ ...input, expectedConfigToken: "0".repeat(64) })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("相同配置快照可绑定，过期授权锁后拒绝", async () => {
  await assignDirectRole({
    ...input,
    expectedConfigToken: customRoleConfigToken(role),
  });
  await expect(
    assignDirectRole({ ...input, expiresAt: new Date(0) })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
it("最后系统管理员只计算启用且有效来源，内置管理员可兜底", async () => {
  mocks.query.mockResolvedValue([
    [{ userId: 3, roleId: 19, scopeType: "system", code: "system_admin" }],
  ]);
  await expect(
    revokeDirectRole({ assignmentId: "grant", revokedByUserId: 7 })
  ).rejects.toThrow("至少一位有效");
  expect(
    conn.query.mock.calls.find(([sql]: any) =>
      sql.startsWith("SELECT ra.id")
    )[0]
  ).toContain("u.status='active'");
  accounts.push({ id: 1, role: "admin", status: "active", tokenVersion: 1 });
  await revokeDirectRole({ assignmentId: "grant", revokedByUserId: 7 });
  expect(conn.commit).toHaveBeenCalledOnce();
});
it("授权记录归属变化拒绝，不会撤销其他对象", async () => {
  grant.userId = 4;
  await expect(
    revokeDirectRole({ assignmentId: "grant", revokedByUserId: 7 })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("死锁有界重试，普通错误不重复提交", async () => {
  mocks.audit.mockRejectedValue({ errno: 1213 });
  await expect(assignDirectRole(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(conn.release).toHaveBeenCalledTimes(3);
  expect(conn.commit).not.toHaveBeenCalled();
});
