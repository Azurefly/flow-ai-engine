import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connection: vi.fn(),
  access: vi.fn(),
  project: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: mocks.connection,
  }),
}));
vi.mock("./iam-service", () => ({
  ensureIamCatalog: mocks.ensure,
  getWorkflowAccess: mocks.access,
}));
vi.mock("./project-service", () => ({ ensureProjectUnitTable: mocks.ensure }));
vi.mock("./project-lifecycle-lock", () => ({
  lockActiveProject: mocks.project,
}));
import { commitWorkflowAuthorization } from "./workflow-authorization-transaction";
const actor = { id: 7, role: "user" as const, tokenVersion: 1 };
const workflow = { ownerUserId: 5, projectId: "project", archivedAt: null };
function setup(
  account: any = { ...actor, status: "active" },
  flow: any = workflow
) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi
      .fn()
      .mockImplementation((statement: string) =>
        Promise.resolve([
          statement.includes("FROM users")
            ? [
                account,
                { id: 3, status: "active" },
                { id: 5, status: "active" },
              ].filter(Boolean)
            : [flow].filter(Boolean),
        ])
      ),
  };
  mocks.connection.mockResolvedValue(connection);
  return connection;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue([[workflow]]);
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["workflow:members:manage"]),
  });
});
it("排序锁定账号、锁定业务与流程，同连接复核后提交", async () => {
  const connection = setup();
  const write = vi.fn(async ({ recheck, target, creator }) => {
    await recheck();
    expect(target.id).toBe(3);
    expect(creator.id).toBe(5);
    return true;
  });
  expect(await commitWorkflowAuthorization(actor, "flow", 3, write)).toBe(true);
  expect(connection.query).toHaveBeenCalledWith(
    expect.stringContaining("ORDER BY id FOR UPDATE"),
    [[3, 5, 7]]
  );
  expect(mocks.project).toHaveBeenCalledWith(connection, "project");
  expect(mocks.access).toHaveBeenCalledWith({ id: 7, role: "user" }, "flow", {
    connection,
    lock: true,
  });
  expect(mocks.access).toHaveBeenCalledTimes(2);
  expect(connection.commit).toHaveBeenCalledOnce();
});
it.each([
  null,
  { ...actor, status: "disabled" },
  { ...actor, status: "active", tokenVersion: 2 },
])("账号或会话变化回滚 %j", async account => {
  const connection = setup(account),
    write = vi.fn();
  await expect(
    commitWorkflowAuthorization(actor, "flow", 3, write)
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(write).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledOnce();
  expect(connection.release).toHaveBeenCalledOnce();
});
it.each([
  null,
  { ...workflow, archivedAt: new Date() },
  { ...workflow, ownerUserId: 9 },
  { ...workflow, projectId: "other" },
])("流程归属或归档变化拒绝修改 %j", async flow => {
  const connection = setup(undefined, flow),
    write = vi.fn();
  await expect(
    commitWorkflowAuthorization(actor, "flow", 3, write)
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(write).not.toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
});
it("等待后失权拒绝修改", async () => {
  const connection = setup(),
    write = vi.fn();
  mocks.access.mockResolvedValue({ exists: true, permissions: new Set() });
  await expect(
    commitWorkflowAuthorization(actor, "flow", 3, write)
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(write).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledOnce();
});
it("审计异常回滚，保留原始异常，始终释放连接", async () => {
  const connection = setup(),
    failure = new Error("audit rejected");
  connection.rollback.mockRejectedValue(new Error("rollback failed"));
  await expect(
    commitWorkflowAuthorization(actor, "flow", 3, async () => {
      throw failure;
    })
  ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", cause: failure });
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledOnce();
});
it("死锁重试重新复核，三次后返回可恢复冲突", async () => {
  const connection = setup(),
    write = vi.fn().mockRejectedValue({ errno: 1213 });
  await expect(
    commitWorkflowAuthorization(actor, "flow", 3, write)
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(write).toHaveBeenCalledTimes(3);
  expect(mocks.access).toHaveBeenCalledTimes(3);
  expect(connection.rollback).toHaveBeenCalledTimes(3);
  expect(connection.release).toHaveBeenCalledTimes(3);
});
