import type mysql from "mysql2/promise";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  query: vi.fn(),
  project: vi.fn(),
  assigned: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: mocks.pool }));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.project }));
vi.mock("./iam-locked-permissions", () => ({
  readLockedAssignedPermissions: mocks.assigned,
}));
import { getWorkflowAccess } from "./iam-service";
const connection = { query: mocks.query } as unknown as mysql.PoolConnection;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pool.mockImplementation(() => {
    throw new Error(
      "Transaction must not acquire another connection or run DDL"
    );
  });
  mocks.query.mockImplementation(async (sql: string) => [
    sql.includes("FROM workflow WHERE")
      ? [{ ownerUserId: 8, projectId: "project" }]
      : [{ role: "viewer" }],
  ]);
  mocks.project.mockResolvedValue({ roles: ["designer"] });
  mocks.assigned.mockResolvedValue(new Set(["workflow:run"]));
});
it("事务授权合并成员、业务及自定义角色，在原连接锁定读取", async () => {
  const result = await getWorkflowAccess({ id: 7, role: "user" }, "flow", {
    connection,
    lock: true,
  });
  expect(result.permissions).toEqual(
    new Set([
      "workflow:view",
      "workflow:edit",
      "workflow:publish",
      "workflow:run",
    ])
  );
  expect(mocks.pool).not.toHaveBeenCalled();
  expect(mocks.project).toHaveBeenCalledWith(
    { id: 7, role: "user" },
    "project",
    { includeArchived: true, connection, lock: true }
  );
  expect(mocks.assigned).toHaveBeenCalledWith(connection, 7, "flow");
  for (const [sql] of mocks.query.mock.calls)
    expect(sql).toContain("FOR SHARE");
});
it("最新授权均已撤销时保留空权限，不沿用此前调用结果", async () => {
  mocks.query.mockImplementation(async (sql: string) => [
    sql.includes("FROM workflow WHERE")
      ? [{ ownerUserId: 8, projectId: "project" }]
      : [],
  ]);
  mocks.project.mockResolvedValue({ roles: [] });
  mocks.assigned.mockResolvedValue(new Set());
  expect(
    (
      await getWorkflowAccess({ id: 7, role: "user" }, "flow", {
        connection,
        lock: true,
      })
    ).permissions.size
  ).toBe(0);
});
it("已删除的流程不再解析成员及继承角色", async () => {
  mocks.query.mockResolvedValue([[]]);
  expect(
    (
      await getWorkflowAccess({ id: 7, role: "user" }, "flow", {
        connection,
        lock: true,
      })
    ).exists
  ).toBe(false);
  expect(mocks.project).not.toHaveBeenCalled();
  expect(mocks.assigned).not.toHaveBeenCalled();
});
it("已验证的管理员与原所有者无需锁定无关授权记录", async () => {
  for (const user of [
    { id: 7, role: "admin" as const },
    { id: 8, role: "user" as const },
  ]) {
    expect(
      (
        await getWorkflowAccess(user, "flow", { connection, lock: true })
      ).permissions.has("workflow:publish")
    ).toBe(true);
  }
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.assigned).not.toHaveBeenCalled();
});
