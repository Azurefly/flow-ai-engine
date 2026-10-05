import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  audit: vi.fn(),
  acquire: vi.fn(),
  unlock: vi.fn(),
  release: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => ({
      query: async (sql: string, params?: unknown[]) =>
        sql.includes("GET_LOCK")
          ? mocks.acquire()
          : sql.includes("RELEASE_LOCK")
            ? mocks.unlock()
            : mocks.query(sql, params),
      release: mocks.release,
      destroy: mocks.destroy,
    }),
  }),
}));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: mocks.audit }));
import {
  createOrganizationUnit,
  updateOrganizationUnit,
} from "./organization-service";
const user = { id: 1, role: "admin" as const };
const input = { code: " team ", name: "研发部" };
const duplicate = {
  code: "ER_DUP_ENTRY",
  errno: 1062,
  message:
    "Duplicate entry 'TEAM' for key 'organization_unit.organization_unit_code_unique'",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.acquire.mockResolvedValue([[{ acquired: 1 }], []]);
  mocks.unlock.mockResolvedValue([[{ released: 1 }], []]);
});
it("重复部门编码转换为可操作中文错误且不写成功审计", async () => {
  mocks.query.mockRejectedValueOnce(duplicate);
  await expect(createOrganizationUnit(user, input)).rejects.toThrow(
    "部门编码已存在，请使用其他编码"
  );
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("并发重复创建均保留数据库唯一约束的错误处理", async () => {
  mocks.query.mockRejectedValue(duplicate);
  const results = await Promise.allSettled([
    createOrganizationUnit(user, input),
    createOrganizationUnit(user, input),
  ]);
  expect(
    results.every(
      r =>
        r.status === "rejected" && r.reason.message.startsWith("部门编码已存在")
    )
  ).toBe(true);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("其他数据库错误不伪装成部门编码冲突", async () => {
  const other = { ...duplicate, message: "Duplicate entry for key 'PRIMARY'" };
  mocks.query.mockRejectedValueOnce(other);
  await expect(createOrganizationUnit(user, input)).rejects.toBe(other);
});
it("创建成功继续规范编码并记录审计", async () => {
  mocks.query.mockResolvedValueOnce([{}, []]);
  const id = await createOrganizationUnit(user, input);
  expect(mocks.query.mock.calls[0][1][1]).toBe("TEAM");
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      resourceId: id,
      details: { operation: "organization_unit_created", code: "TEAM" },
    })
  );
});

it("上级已有循环时提前拒绝，不执行更新", async () => {
  mocks.query.mockImplementation(async (sql: string, params: string[]) => {
    if (sql.startsWith("SELECT *")) return [[{ id: "moving" }], []];
    if (sql.includes("status='active'")) return [[{ id: "a" }], []];
    return [[{ parentUnitId: params[0] === "a" ? "b" : "a" }], []];
  });
  await expect(
    updateOrganizationUnit(user, { id: "moving", parentUnitId: "a" })
  ).rejects.toThrow("存在循环");
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(
    false
  );
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("遍历32层仍未到根节点时拒绝保存，不能漏检更深循环", async () => {
  mocks.query.mockImplementation(async (sql: string, params: string[]) => {
    if (sql.startsWith("SELECT *")) return [[{ id: "moving" }], []];
    if (sql.includes("status='active'")) return [[{ id: "0" }], []];
    return [[{ parentUnitId: String(Number(params[0]) + 1) }], []];
  });
  await expect(
    updateOrganizationUnit(user, { id: "moving", parentUnitId: "0" })
  ).rejects.toThrow("无法完成循环检查");
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(
    false
  );
});
it("正常根部门路径仍可迁移保存", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT *"))
      return [[{ id: "moving", name: "部门" }], []];
    if (sql.includes("status='active'")) return [[{ id: "root" }], []];
    if (sql.startsWith("SELECT parentUnitId"))
      return [[{ parentUnitId: null }], []];
    return [{}, []];
  });
  await updateOrganizationUnit(user, { id: "moving", parentUnitId: "root" });
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(
    true
  );
  expect(mocks.audit).toHaveBeenCalledTimes(1);
});

it("锁等待超时不更新组织，连接正常归还且不释放他人的锁", async () => {
  mocks.acquire.mockResolvedValueOnce([[{ acquired: 0 }], []]);
  await expect(updateOrganizationUnit(user, { id: "moving" })).rejects.toThrow(
    "稍后重试"
  );
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.unlock).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledTimes(1);
  expect(mocks.destroy).not.toHaveBeenCalled();
});
it("加锁响应失败销毁连接，避免未知锁状态进入连接池", async () => {
  mocks.acquire.mockRejectedValueOnce(new Error("connection interrupted"));
  await expect(updateOrganizationUnit(user, { id: "moving" })).rejects.toThrow(
    "connection interrupted"
  );
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.destroy).toHaveBeenCalledTimes(1);
});
it("业务拒绝后仍释放锁并归还连接", async () => {
  mocks.query.mockResolvedValueOnce([[{ id: "moving" }], []]);
  await expect(
    updateOrganizationUnit(user, { id: "moving", parentUnitId: "moving" })
  ).rejects.toThrow("不能把自身");
  expect(mocks.unlock).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledTimes(1);
});
it("更新成功但释放失败时销毁连接，保留成功结果而不诱导重复保存", async () => {
  mocks.query
    .mockResolvedValueOnce([[{ id: "moving", name: "部门" }], []])
    .mockResolvedValueOnce([{}, []]);
  mocks.unlock.mockRejectedValueOnce(new Error("unlock interrupted"));
  await expect(updateOrganizationUnit(user, { id: "moving" })).resolves.toBe(
    true
  );
  expect(mocks.audit).toHaveBeenCalledTimes(1);
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.destroy).toHaveBeenCalledTimes(1);
});
