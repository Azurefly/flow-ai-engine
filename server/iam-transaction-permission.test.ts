import type mysql from "mysql2/promise";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: mocks.pool }));
import { hasSystemPermission } from "./iam-service";
const connection = { query: mocks.query } as unknown as mysql.PoolConnection;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pool.mockImplementation(() => {
    throw new Error("事务内不能另取连接");
  });
});
it("委派管理员的权限在已有事务连接查询，避免连接池互相等待", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM role_assignment"))
      return [[{ roleId: 2, scopeType: "system" }]];
    if (sql.includes("FROM organization_membership")) return [[]];
    if (sql.includes("FROM iam_role")) return [[{ id: 2, code: "custom_iam" }]];
    if (sql.includes("FROM role_permission")) return [[{ permissionId: 3 }]];
    if (sql.includes("FROM permission")) return [[{ code: "iam:manage" }]];
    throw new Error("Unexpected current read");
  });
  expect(
    await hasSystemPermission(
      { id: 17, role: "user" },
      "iam:manage",
      connection
    )
  ).toBe(true);
  expect(mocks.pool).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(5);
  for (const [sql] of mocks.query.mock.calls)
    expect(sql).toContain("FOR SHARE");
});
it("已撤销的事务权限不会使用之前的目录结果", async () => {
  mocks.query.mockResolvedValue([[]]);
  expect(
    await hasSystemPermission(
      { id: 17, role: "user" },
      "iam:manage",
      connection
    )
  ).toBe(false);
  expect(mocks.pool).not.toHaveBeenCalled();
});
it("系统管理员保持已有权限快捷判断", async () => {
  expect(
    await hasSystemPermission(
      { id: 17, role: "admin" },
      "iam:manage",
      connection
    )
  ).toBe(true);
  expect(mocks.query).not.toHaveBeenCalled();
});
