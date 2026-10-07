import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getConnection: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  beginTransaction: vi.fn(),
  outerQuery: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.outerQuery,
    getConnection: mocks.getConnection,
  }),
}));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: vi.fn() }));
import {
  assignOrganizationMember,
  removeOrganizationMember,
  setPrimaryOrganizationMembership,
  moveOrganizationMember,
} from "./organization-service";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.outerQuery.mockResolvedValue([[{ id: 9 }]]);
  mocks.query.mockImplementation(async (sql: string) =>
    sql.startsWith("SELECT")
      ? [[{ id: "test-member", title: "测试", isPrimary: true }]]
      : [{ affectedRows: 1 }]
  );
  mocks.getConnection.mockResolvedValue({
    query: mocks.query,
    commit: mocks.commit,
    rollback: mocks.rollback,
    release: mocks.release,
    beginTransaction: mocks.beginTransaction,
  });
});
const actor = { id: 7, role: "admin" as const };
it.each([
  [
    "加入部门",
    () =>
      assignOrganizationMember(actor, {
        unitId: "unit-a",
        userId: 9,
        isPrimary: true,
      }),
  ],
  [
    "设置主部门",
    () =>
      setPrimaryOrganizationMembership(actor, { unitId: "unit-a", userId: 9 }),
  ],
  [
    "迁移部门",
    () =>
      moveOrganizationMember(actor, {
        fromUnitId: "unit-a",
        toUnitId: "unit-b",
        userId: 9,
      }),
  ],
  [
    "移除部门",
    () => removeOrganizationMember(actor, { unitId: "unit-a", userId: 9 }),
  ],
] as const)("%s 先锁用户再修改成员关系", async (_, run) => {
  await run();
  expect(mocks.query.mock.calls[0][0]).toBe(
    "SELECT id FROM users WHERE id=? LIMIT 1 FOR UPDATE"
  );
  expect(mocks.query.mock.calls[0][1]).toEqual([9]);
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.rollback).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("用户不存在时回滚，禁止继续修改成员关系", async () => {
  mocks.query.mockResolvedValueOnce([[]]);
  await expect(
    setPrimaryOrganizationMembership(actor, { unitId: "unit-a", userId: 9 })
  ).rejects.toThrow("账号不存在");
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
