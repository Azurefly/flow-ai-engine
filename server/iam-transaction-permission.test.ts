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
  mocks.query.mockResolvedValueOnce([[{ code: "iam:manage" }], []]);
  expect(
    await hasSystemPermission(
      { id: 17, role: "user" },
      "iam:manage",
      connection
    )
  ).toBe(true);
  expect(mocks.pool).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledOnce();
  expect(mocks.query.mock.calls[0][0]).toContain(
    "WITH RECURSIVE membership_units"
  );
});
it("已撤销的事务权限不会使用之前的目录结果", async () => {
  mocks.query.mockResolvedValueOnce([[], []]);
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
