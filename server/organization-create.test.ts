import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => ({
      query: async (sql: string, params?: unknown[]) =>
        sql.includes("GET_LOCK")
          ? [[{ acquired: 1 }], []]
          : sql.includes("RELEASE_LOCK")
            ? [[{ released: 1 }], []]
            : mocks.query(sql, params),
      release: () => {},
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
