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
import { assignRole, deleteCustomRole, ensureIamCatalog } from "./iam-service";
let disabled = false,
  duplicate = false,
  organization = false,
  isSystem = false,
  failInsert = false;
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
    if (sql.startsWith("SELECT id,scope FROM iam_role"))
      return [[{ id: 31, scope: "workflow" }]];
    if (sql.startsWith("SELECT id,isSystem FROM iam_role"))
      return [[{ id: 31, isSystem: isSystem ? 1 : 0 }]];
    if (sql.includes("SELECT id FROM role_assignment"))
      return [duplicate ? [{ id: "existing" }] : []];
    if (sql.includes("SELECT id FROM organization_unit_role"))
      return [organization ? [{ id: "organization" }] : []];
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
    deleteCustomRole({ code: "custom_tx_test", actorUserId: 17 })
  ).rejects.toThrow("组织权限中解除绑定");
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(
    false
  );
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
});
it("删除内置角色被拒绝", async () => {
  isSystem = true;
  await expect(
    deleteCustomRole({ code: "custom_tx_test", actorUserId: 17 })
  ).rejects.toThrow("可删除的自定义角色");
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(
    false
  );
});
it("无有效绑定时先清理历史引用再删除自定义角色", async () => {
  await deleteCustomRole({ code: "custom_tx_test", actorUserId: 17 });
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
  expect(mocks.audit).toHaveBeenCalledTimes(1);
});
