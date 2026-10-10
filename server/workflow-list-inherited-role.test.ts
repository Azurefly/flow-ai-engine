import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), permission: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  getWorkflowAccess: vi.fn(),
  hasSystemPermission: mocks.permission,
  recordAuthorizationAudit: vi.fn(),
}));
import { listWorkflowPage, listWorkflows } from "./workflow-service";
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
  expect(mocks.query.mock.calls[0][1]).toEqual([200, 0]);
});
it("没有全局查看权限的用户仍按资源范围查询", async () => {
  mocks.permission.mockResolvedValue(false);
  await listWorkflows({ id: 7, role: "user" });
  expect(mocks.query.mock.calls[0][0]).toContain("ra.scopeId=w.id");
  expect(mocks.query.mock.calls[0][1]).toEqual([7, 7, 7, 7, 7, 7, 200, 0]);
});
it("管理员无需额外解析组织权限", async () => {
  await listWorkflows({ id: 7, role: "admin" });
  expect(mocks.permission).not.toHaveBeenCalled();
  expect(mocks.query.mock.calls[0][1]).toEqual([200, 0]);
});
it("默认十条并读取额外一条判断下一页，能查询200条之后", async () => {
  mocks.query.mockResolvedValue([Array.from({ length: 11 }, (_, index) => ({ id: String(index), definitionJson: {} }))]);
  const page = await listWorkflowPage({ id: 7, role: "admin" }, { cursor: 200 });
  expect(page.items).toHaveLength(10);
  expect(page.nextCursor).toBe(210);
  expect(page.hasMore).toBe(true);
  expect(mocks.query.mock.calls[0][1]).toEqual([11, 200]);
  expect(mocks.query.mock.calls[0][0]).toContain("w.updatedAt DESC,w.id DESC");
});
it("普通账号搜索与项目筛选继续受资源范围约束，通配符按字面搜索", async () => {
  mocks.permission.mockResolvedValue(false);
  const page = await listWorkflowPage({ id: 7, role: "user" }, { search: "a_%", projectId: "own-project" });
  expect(page.hasMore).toBe(false);
  expect(page.nextCursor).toBeUndefined();
  expect(mocks.query.mock.calls[0][0]).toContain("ra.scopeId=w.id");
  expect(mocks.query.mock.calls[0][1]).toEqual([7, 7, 7, 7, 7, 7, "own-project", "%a!_!%%", "%a!_!%%", "%a!_!%%", 11, 0]);
});
