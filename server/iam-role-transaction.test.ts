import { beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  audit: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  getConnection: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    getConnection: mocks.getConnection,
    query: mocks.audit,
  }),
}));
import {
  assignRole,
  createCustomRole,
  deleteCustomRole,
  updateCustomRole,
  ensureIamCatalog,
} from "./iam-service";
import { customRoleConfigToken } from "./custom-role-configuration";
const roleFixture = {
  id: 31,
  code: "custom_tx_test",
  name: "测试角色",
  description: null,
  scope: "workflow",
  isSystem: 0,
  permissions: ["workflow:view"],
};
const expectedConfigToken = customRoleConfigToken(roleFixture);
let changedRole = false,
  changedPermissions = false,
  actorDisabled = false,
  actorVersion = 1;
let failAudit = false;
let disabled = false,
  duplicate = false,
  organization = false,
  isSystem = false,
  failInsert = false;
failAudit = false;
const connection = {
  query: mocks.query,
  beginTransaction: mocks.begin,
  commit: mocks.commit,
  rollback: mocks.rollback,
  release: mocks.release,
};
beforeAll(async () => {
  mocks.getConnection.mockResolvedValue(connection);
  mocks.query.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.startsWith("SELECT id,code FROM"))
      return [
        (params[0] as string[]).map((code, index) => ({ id: index + 1, code })),
      ];
    if (sql.startsWith("SELECT status FROM users"))
      return [[{ status: disabled ? "disabled" : "active" }]];
    if (sql.startsWith("SELECT id,role,status,tokenVersion FROM users"))
      return [
        [
          {
            id: 17,
            role: "admin",
            status: actorDisabled ? "disabled" : "active",
            tokenVersion: actorVersion,
          },
        ],
      ];
    if (
      sql.startsWith(
        "SELECT id,code,scope,isSystem,name,description FROM iam_role"
      )
    )
      return [
        [
          {
            ...roleFixture,
            name: changedRole ? "其他管理员的新角色" : roleFixture.name,
            isSystem: isSystem ? 1 : 0,
          },
        ],
      ];
    if (sql.startsWith("SELECT permissionId FROM role_permission"))
      return [[{ permissionId: changedPermissions ? 2 : 1 }]];
    if (sql.startsWith("SELECT code FROM permission WHERE id"))
      return [[{ code: changedPermissions ? "workflow:run" : "workflow:view" }]];
    if (sql.startsWith("SELECT id,scope FROM iam_role"))
      return [[{ id: 31, scope: "workflow" }]];
    if (sql.startsWith("SELECT id,isSystem FROM iam_role"))
      return [[{ id: 31, isSystem: isSystem ? 1 : 0 }]];
    if (sql.includes("SELECT id FROM role_assignment"))
      return [duplicate ? [{ id: "existing" }] : []];
    if (sql.includes("SELECT id FROM organization_unit_role"))
      return [organization ? [{ id: "organization" }] : []];
    if (sql.startsWith("INSERT INTO authorization_audit_log") && failAudit)
      throw new Error("audit failed");
    if (sql.startsWith("INSERT INTO iam_role")) return [{ insertId: 31 }];
    if (sql.startsWith("INSERT INTO role_assignment") && failInsert)
      throw new Error("write failed");
    return [[]];
  });
  mocks.audit.mockResolvedValue([[]]);
  await ensureIamCatalog();
});
beforeEach(() => {
  vi.clearAllMocks();
  disabled = false;
  duplicate = false;
  organization = false;
  isSystem = false;
  failInsert = false;
  failAudit = false;
  changedRole = false;
  changedPermissions = false;
  actorDisabled = false;
  actorVersion = 1;
});
const input = {
  userId: 2,
  roleCode: "custom_tx_test",
  scopeType: "workflow" as const,
  scopeId: "workflow-a",
  grantedByUserId: 17,
};
it("绑定在事务内按用户、角色顺序加锁，并在提交后记录审计", async () => {
  await assignRole(input);
  expect(mocks.begin).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][0]).toContain("users WHERE id=? FOR UPDATE");
  expect(mocks.query.mock.calls[1][0]).toContain(
    "iam_role WHERE code=? LIMIT 1 FOR UPDATE"
  );
  expect(mocks.query.mock.calls[2][0]).toContain("scopeId <=> ?");
  expect(mocks.query.mock.calls[2][0]).toContain("FOR UPDATE");
  expect(mocks.commit).toHaveBeenCalledTimes(1);
  expect(mocks.rollback).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledTimes(1);
  expect(mocks.audit).toHaveBeenCalledTimes(1);
});
it("重复绑定不写入，回滚并释放连接", async () => {
  duplicate = true;
  await expect(assignRole(input)).rejects.toThrow("请勿重复绑定");
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      sql.startsWith("INSERT INTO role_assignment")
    )
  ).toBe(false);
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledTimes(1);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("停用账号在角色检查之前拒绝", async () => {
  disabled = true;
  await expect(assignRole(input)).rejects.toThrow("启用中的用户");
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
});
it("写入错误回滚，不记录成功审计", async () => {
  failInsert = true;
  await expect(assignRole(input)).rejects.toThrow("write failed");
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("有组织绑定时给出清楚原因，不删除角色", async () => {
  organization = true;
  await expect(
    deleteCustomRole({
      code: "custom_tx_test",
      actorUserId: 17,
      expectedConfigToken,
    })
  ).rejects.toThrow("组织权限中解除绑定");
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(
    false
  );
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
});
it("删除内置角色被拒绝", async () => {
  isSystem = true;
  await expect(
    deleteCustomRole({
      code: "custom_tx_test",
      actorUserId: 17,
      expectedConfigToken,
    })
  ).rejects.toThrow("自定义角色");
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(
    false
  );
});
it("无有效绑定时先清理历史引用再删除自定义角色", async () => {
  await deleteCustomRole({
    code: "custom_tx_test",
    actorUserId: 17,
    expectedConfigToken,
  });
  expect(
    mocks.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT id FROM role_assignment")
    )?.[0]
  ).toContain("expiresAt>NOW()");
  expect(
    mocks.query.mock.calls
      .filter(([sql]) => sql.startsWith("DELETE"))
      .map(([sql]) => sql)
  ).toEqual([
    "DELETE FROM organization_unit_role WHERE roleId=?",
    "DELETE FROM role_assignment WHERE roleId=?",
    "DELETE FROM role_permission WHERE roleId=?",
    "DELETE FROM iam_role WHERE id=?",
  ]);
  expect(mocks.commit).toHaveBeenCalledTimes(1);
  const auditIndex = mocks.query.mock.calls.findIndex(([sql]) =>
    sql.startsWith("INSERT INTO authorization_audit_log")
  );
  expect(auditIndex).toBeGreaterThan(-1);
  expect(mocks.query.mock.invocationCallOrder[auditIndex]).toBeLessThan(
    mocks.commit.mock.invocationCallOrder[0]
  );
});

it("角色创建的审计写入失败时一起回滚，不返回部分成功", async () => {
  failAudit = true;
  await expect(
    createCustomRole({
      code: "custom_tx_test",
      name: "测试角色",
      scope: "workflow",
      permissions: ["workflow:view"],
      actorUserId: 17,
    })
  ).rejects.toThrow("audit failed");
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledTimes(1);
});

it.each(["update", "delete"])(
  "过期快照阻止 %s，保留权限并回滚",
  async operation => {
    changedRole = true;
    const input = {
      code: roleFixture.code,
      actorUserId: 17,
      expectedConfigToken,
    };
    await expect(
      operation === "update"
        ? updateCustomRole({ ...input, name: "旧窗口覆盖" })
        : deleteCustomRole(input)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      mocks.query.mock.calls.some(
        ([sql]) =>
          sql.startsWith("UPDATE") ||
          sql.startsWith("DELETE") ||
          sql.startsWith("INSERT INTO authorization_audit_log")
      )
    ).toBe(false);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  }
);
it.each(["update", "delete"])(
  "缺少配置快照时 %s 不能绕过保护",
  async operation => {
    const input = { code: roleFixture.code, actorUserId: 17 };
    await expect(
      operation === "update"
        ? updateCustomRole({ ...input, name: "未读取配置" })
        : deleteCustomRole(input)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      mocks.query.mock.calls.some(
        ([sql]) => sql.startsWith("UPDATE") || sql.startsWith("DELETE")
      )
    ).toBe(false);
  }
);
it("有效快照更新的角色与审计一起提交", async () => {
  await updateCustomRole({
    code: roleFixture.code,
    actorUserId: 17,
    expectedConfigToken,
    name: "新名称",
    permissions: ["workflow:view", "workflow:run"],
  });
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.rollback).not.toHaveBeenCalled();
  const audit = mocks.query.mock.calls.findIndex(([sql]) =>
    sql.startsWith("INSERT INTO authorization_audit_log")
  );
  expect(audit).toBeGreaterThan(-1);
  expect(mocks.query.mock.invocationCallOrder[audit]).toBeLessThan(
    mocks.commit.mock.invocationCallOrder[0]
  );
});
it("等待角色锁后以当前读校验权限变化，且不锁共享权限目录", async () => {
  changedPermissions = true;
  await expect(updateCustomRole({ code: roleFixture.code, actorUserId: 17, expectedConfigToken, name: roleFixture.name })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.query.mock.calls.some(([sql]) => sql === "SELECT permissionId FROM role_permission WHERE roleId=? ORDER BY permissionId FOR UPDATE")).toBe(true);
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes("JOIN permission") && sql.includes("FOR UPDATE"))).toBe(false);
  expect(mocks.commit).not.toHaveBeenCalled();
});
it.each(["disabled", "version"])("锁内复核角色管理员的 %s 状态", async mode => {
  if (mode === "disabled") actorDisabled = true;
  else actorVersion = 3;
  await expect(
    updateCustomRole({
      code: roleFixture.code,
      actorUserId: 17,
      actorTokenVersion: 1,
      expectedConfigToken,
      name: "无权修改",
    })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.query).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
});
