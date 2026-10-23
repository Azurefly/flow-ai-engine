import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  access: vi.fn(),
  catalog: vi.fn(),
  project: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.getConnection }),
}));
vi.mock("./iam-service", () => ({
  ensureIamCatalog: mocks.catalog,
  getWorkflowAccess: mocks.access,
}));
vi.mock("./project-service", () => ({ ensureProjectUnitTable: mocks.project }));
import {
  commitWorkflowMutation,
  lockWorkflowMutation,
} from "./workflow-mutation-transaction";

const actor = { id: 7, role: "user" as const, tokenVersion: 3 };
const snapshot = {
  ownerUserId: 9,
  projectId: "project-a",
  definitionVersion: 4,
  status: "draft" as const,
  archivedAt: null,
};
function connection(
  current: Record<string, unknown> = {
    id: 7,
    role: "user",
    status: "active",
    tokenVersion: 3,
  }
) {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM users")) return [[current]];
      if (sql.includes("FROM flow_project"))
        return [[{ id: "project-a", status: "active" }]];
      if (sql.includes("FROM workflow"))
        return [[{ id: "workflow-a", ...snapshot }]];
      return [[]];
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set([
      "workflow:view",
      "workflow:edit",
      "workflow:publish",
      "workflow:members:manage",
    ]),
  });
});

it.each([{ status: "disabled" }, { tokenVersion: 4 }, { role: "retired" }])(
  "等待后账号失效时拒绝写入：%j",
  async change => {
    const tx = connection({
      id: 7,
      role: "user",
      status: "active",
      tokenVersion: 3,
      ...change,
    });
    mocks.getConnection.mockResolvedValue(tx);
    const write = vi.fn();
    await expect(commitWorkflowMutation(actor, write)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(write).not.toHaveBeenCalled();
    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledOnce();
    expect(tx.release).toHaveBeenCalledOnce();
  }
);
it("使用锁内最新账号角色，成功结果只在提交后返回", async () => {
  const tx = connection({
    id: 7,
    role: "admin",
    status: "active",
    tokenVersion: 3,
  });
  mocks.getConnection.mockResolvedValue(tx);
  const result = await commitWorkflowMutation(actor, async (conn, fresh) => {
    expect(conn).toBe(tx);
    expect(fresh.role).toBe("admin");
    expect(tx.commit).not.toHaveBeenCalled();
    return "saved";
  });
  expect(result).toBe("saved");
  expect(tx.commit).toHaveBeenCalledOnce();
  expect(tx.rollback).not.toHaveBeenCalled();
});
it("业务、版本或审计失败都会回滚，不返回成功", async () => {
  const tx = connection();
  mocks.getConnection.mockResolvedValue(tx);
  await expect(
    commitWorkflowMutation(actor, async () => {
      throw new Error("audit failure");
    })
  ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  expect(tx.commit).not.toHaveBeenCalled();
  expect(tx.rollback).toHaveBeenCalledOnce();
  expect(tx.release).toHaveBeenCalledOnce();
});
it("死锁有限重试且每次重新读取账号", async () => {
  const tx = connection();
  mocks.getConnection.mockResolvedValue(tx);
  let attempts = 0;
  await expect(
    commitWorkflowMutation(actor, async () => {
      if (++attempts < 3)
        throw Object.assign(new Error(), { code: "ER_LOCK_DEADLOCK" });
      return 8;
    })
  ).resolves.toBe(8);
  expect(tx.beginTransaction).toHaveBeenCalledTimes(3);
  expect(tx.rollback).toHaveBeenCalledTimes(2);
  expect(tx.release).toHaveBeenCalledTimes(3);
  expect(
    tx.query.mock.calls.filter(([sql]) => sql.includes("FROM users"))
  ).toHaveLength(3);
});
it("连续死锁返回冲突并释放所有连接", async () => {
  const tx = connection();
  mocks.getConnection.mockResolvedValue(tx);
  await expect(
    commitWorkflowMutation(actor, async () => {
      throw Object.assign(new Error(), { errno: 1213 });
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(tx.release).toHaveBeenCalledTimes(3);
  expect(tx.commit).not.toHaveBeenCalled();
});
it.each([
  { definitionVersion: 5 },
  { projectId: "other" },
  { ownerUserId: 10 },
  { status: "published" },
  { archivedAt: new Date() },
])("流程快照变化后不继续操作：%j", async change => {
  const tx = connection();
  tx.query.mockImplementation(async sql =>
    sql.includes("FROM workflow")
      ? [[{ ...snapshot, ...change }]]
      : [[{ id: "project-a", status: "active" }]]
  );
  await expect(
    lockWorkflowMutation(tx as any, actor, "workflow-a", snapshot, [
      "workflow:edit",
    ])
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.access).not.toHaveBeenCalled();
});
it("等待后权限撤销使用同一事务当前读拒绝", async () => {
  const tx = connection();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["workflow:view"]),
  });
  await expect(
    lockWorkflowMutation(tx as any, actor, "workflow-a", snapshot, [
      "workflow:edit",
    ])
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.access).toHaveBeenCalledWith(actor, "workflow-a", {
    connection: tx,
    lock: true,
  });
});
it("归档可锁定已归档对象但恢复仍要求业务有效", async () => {
  const tx = connection();
  const archived = {
    ...snapshot,
    archivedAt: new Date("2026-10-23T00:00:00Z"),
  };
  tx.query.mockImplementation(async sql =>
    sql.includes("FROM workflow")
      ? [[archived]]
      : [[{ id: "project-a", status: "archived" }]]
  );
  await expect(
    lockWorkflowMutation(
      tx as any,
      actor,
      "workflow-a",
      archived,
      ["workflow:members:manage"],
      { allowArchived: true, activeProject: false }
    )
  ).resolves.toMatchObject(archived);
  await expect(
    lockWorkflowMutation(
      tx as any,
      actor,
      "workflow-a",
      archived,
      ["workflow:members:manage"],
      { allowArchived: true }
    )
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("客户端版本即使不同于请求开始快照也必须拒绝", async () => {
  const tx = connection();
  await expect(
    lockWorkflowMutation(
      tx as any,
      actor,
      "workflow-a",
      snapshot,
      ["workflow:edit"],
      { expectedDefinitionVersion: 3 }
    )
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
