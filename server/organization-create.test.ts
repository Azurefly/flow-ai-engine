import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: mocks.audit }));
import { createOrganizationUnit } from "./organization-service";
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
