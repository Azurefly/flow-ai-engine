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
vi.mock("./iam-service", () => ({
  ensureIamCatalog: vi.fn(),
  hasSystemPermission: vi.fn().mockResolvedValue(true),
  recordAuthorizationAudit: vi.fn(),
}));
import {
  assignOrganizationMember,
  removeOrganizationMember,
  setPrimaryOrganizationMembership,
  moveOrganizationMember,
} from "./organization-service";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rollback.mockResolvedValue(undefined);
  mocks.outerQuery.mockResolvedValue([[{ id: 9 }]]);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
    if (sql.includes("FROM users WHERE"))
      return [
        [
          { id: 7, role: "admin", status: "active" },
          { id: 9, role: "user", status: "active" },
        ],
      ];
    return sql.startsWith("SELECT")
      ? [
          [
            {
              id: "test-member",
              title: "测试",
              isPrimary: true,
              status: "active",
            },
          ],
        ]
      : [{ affectedRows: 1 }];
  });
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
  const accountRead = mocks.query.mock.calls.find(([sql]) =>
    sql.includes("FROM users WHERE")
  );
  expect(accountRead?.[0]).toBe(
    "SELECT id,role,status,tokenVersion FROM users WHERE id IN (?) ORDER BY id FOR UPDATE"
  );
  expect(accountRead?.[1]).toEqual([[7, 9]]);
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.rollback).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("用户不存在时回滚，禁止继续修改成员关系", async () => {
  const query = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((sql: string, params: any) =>
    sql.includes("FROM users WHERE")
      ? Promise.resolve([[{ id: 7, role: "admin", status: "active" }]])
      : query(sql, params)
  );
  await expect(
    setPrimaryOrganizationMembership(actor, { unitId: "unit-a", userId: 9 })
  ).rejects.toThrow("账号不存在");
  expect(
    mocks.query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))
  ).toBe(false);
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
