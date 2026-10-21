import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  ensure: vi.fn(),
  access: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.connection }),
}));
vi.mock("./project-service", () => ({
  ensureProjectUnitTable: mocks.ensure,
  getProjectAccess: mocks.access,
}));
import { commitProjectAuthorization } from "./project-authorization-transaction";
const user = { id: 7, role: "user" as const, tokenVersion: 1 };
function setup(actor: any = { ...user, status: "active" }) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi
      .fn()
      .mockResolvedValue([
        [actor, { id: 3, role: "user", status: "active" }].filter(Boolean),
      ]),
  };
  mocks.connection.mockResolvedValue(connection);
  return connection;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:manage"]),
  });
});
it("按账号顺序锁定操作者和目标，在原连接复核业务授权再提交", async () => {
  const conn = setup(),
    write = vi.fn().mockResolvedValue(true);
  expect(await commitProjectAuthorization(user, "project", 3, write)).toBe(
    true
  );
  expect(conn.query).toHaveBeenCalledWith(
    expect.stringContaining("ORDER BY id FOR UPDATE"),
    [[3, 7]]
  );
  expect(mocks.access).toHaveBeenCalledWith(
    { id: 7, role: "user" },
    "project",
    { connection: conn, lock: true }
  );
  expect(write).toHaveBeenCalledWith(conn, expect.objectContaining({ id: 3 }));
  expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(
    write.mock.invocationCallOrder[0]
  );
  expect(conn.commit).toHaveBeenCalledOnce();
});
it.each([
  null,
  { ...user, status: "disabled" },
  { ...user, status: "active", tokenVersion: 2 },
])("账号或会话变化拒绝写入 %j", async actor => {
  const conn = setup(actor),
    write = vi.fn();
  await expect(
    commitProjectAuthorization(user, "project", undefined, write)
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(write).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
});
it.each([
  { exists: false, permissions: new Set() },
  { exists: true, permissions: new Set(["project:view"]) },
])("归档或管理权撤销后不调用写入 %j", async access => {
  const conn = setup(),
    write = vi.fn();
  mocks.access.mockResolvedValue(access);
  await expect(
    commitProjectAuthorization(user, "project", undefined, write)
  ).rejects.toMatchObject({ code: access.exists ? "FORBIDDEN" : "CONFLICT" });
  expect(write).not.toHaveBeenCalled();
  expect(conn.commit).not.toHaveBeenCalled();
});
it("首次死锁完整回滚后重新锁定和复核权限，不重复提交", async () => {
  const conn = setup(),
    write = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("deadlock"), { errno: 1213 })
      )
      .mockResolvedValue(true);
  await commitProjectAuthorization(user, "project", undefined, write);
  expect(mocks.access).toHaveBeenCalledTimes(2);
  expect(conn.commit).toHaveBeenCalledOnce();
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.release).toHaveBeenCalledTimes(2);
});
it("连续死锁最多三次，给出保留填写的可恢复冲突", async () => {
  const conn = setup(),
    write = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" })
      );
  await expect(
    commitProjectAuthorization(user, "project", undefined, write)
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(write).toHaveBeenCalledTimes(3);
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledTimes(3);
});
