import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), permission: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  getWorkflowAccess: vi.fn(),
  hasSystemPermission: mocks.permission,
  recordAuthorizationAudit: vi.fn(),
}));
import { listWorkflows } from "./workflow-service";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue([[]]);
});
it("组织继承的全局查看权限使流程出现在首页列表", async () => {
  mocks.permission.mockResolvedValue(true);
  await listWorkflows({ id: 7, role: "user" });
  expect(mocks.permission).toHaveBeenCalledWith({ id: 7, role: "user" }, "workflow:view");
  expect(mocks.query.mock.calls[0][0]).not.toContain("workflow_member");
  expect(mocks.query.mock.calls[0][0]).toContain("w.archivedAt IS NULL");
  expect(mocks.query.mock.calls[0][1]).toEqual([]);
});
it("没有全局查看权限的用户仍按资源范围查询", async () => {
  mocks.permission.mockResolvedValue(false);
  await listWorkflows({ id: 7, role: "user" });
  expect(mocks.query.mock.calls[0][0]).toContain("ra.scopeId=w.id");
  expect(mocks.query.mock.calls[0][1]).toEqual([7, 7, 7, 7, 7, 7]);
});
it("管理员无需额外解析组织权限", async () => {
  await listWorkflows({ id: 7, role: "admin" });
  expect(mocks.permission).not.toHaveBeenCalled();
  expect(mocks.query.mock.calls[0][1]).toEqual([]);
});
