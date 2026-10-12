import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(), permission: vi.fn(), audit: vi.fn(), transactionQuery: vi.fn(),
  begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query, getConnection: async () => ({ query: mocks.transactionQuery, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }) }) }));
vi.mock("./iam-service", () => ({ hasSystemPermission: mocks.permission, recordAuthorizationAudit: mocks.audit }));
import { createProject, existingProjectCodes } from "./project-service";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.query.mockResolvedValue([[]]);
});
const user = { id: 7, role: "user" as const };
it("导入预检只读取当前所有者的所选代号，包括已归档项目保留的代号", async () => {
  mocks.query.mockResolvedValue([[{ code: "OPS" }]]);
  expect(await existingProjectCodes(user, [" ops ", "HR"])).toEqual(["OPS"]);
  expect(mocks.query).toHaveBeenCalledWith("SELECT code FROM flow_project WHERE ownerUserId=? AND code IN (?)", [7, ["OPS", "HR"]]);
});
it("无项目创建权限不读取代号，不能探测其他所有者的私有项目", async () => {
  mocks.permission.mockResolvedValue(false);
  await expect(existingProjectCodes(user, ["OPS"])).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.query).not.toHaveBeenCalled();
});
it.each([[], ["1_INVALID"], Array(501).fill("OPS")])("无效或超过批次上限的预检不执行查询", async codes => {
  await expect(existingProjectCodes(user, codes)).rejects.toThrow();
  expect(mocks.query).not.toHaveBeenCalled();
});
it("预检后并发创建仍由唯一约束拦截，返回中文错误并回滚事务", async () => {
  mocks.transactionQuery.mockRejectedValue({ code: "ER_DUP_ENTRY", errno: 1062 });
  await expect(createProject(user, { code: "OPS", name: "运营" })).rejects.toMatchObject({ code: "CONFLICT", message: "业务代号已存在，请更换代号；已归档业务也会保留原代号。" });
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
