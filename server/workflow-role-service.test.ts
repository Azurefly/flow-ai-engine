import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  roles: vi.fn(),
  query: vi.fn(),
  assign: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  getWorkflowAccess: mocks.access,
  listRoles: mocks.roles,
  listPermissionCatalog: () => [
    { code: "workflow:view", name: "查看流程", workflowAllowed: true },
  ],
  validateRoleCode: (code: string) => {
    if (!code.startsWith("custom_")) throw new Error("非法编码");
    return code;
  },
}));
vi.mock("./workflow-authorization-service", () => ({
  grantCustomWorkflowRole: mocks.assign,
  revokeCustomWorkflowRole: mocks.revoke,
}));
import {
  assignWorkflowCustomRole,
  listWorkflowCustomRoles,
  listWorkflowRoleAssignments,
  revokeWorkflowCustomRole,
} from "./workflow-role-service";
const actor = { id: 17, role: "user" as const };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["workflow:members:manage"]),
  });
});
it.each(["list", "assign", "revoke"])(
  "无流程管理权限不能执行 %s",
  async mode => {
    mocks.access.mockResolvedValue({ exists: true, permissions: new Set() });
    const action =
      mode === "list"
        ? listWorkflowCustomRoles(actor, "workflow-a")
        : mode === "assign"
          ? assignWorkflowCustomRole(actor, {
              workflowId: "workflow-a",
              userId: 2,
              roleCode: "custom_reader",
            })
          : revokeWorkflowCustomRole(actor, {
              workflowId: "workflow-a",
              assignmentId: "assignment",
            });
    await expect(action).rejects.toThrow("无权管理此流程");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  }
);
it("角色目录只返回自定义流程角色", async () => {
  mocks.roles.mockResolvedValue([
    { code: "viewer", isSystem: 1 },
    {
      id: 19,
      code: "custom_reader",
      name: "流程阅读",
      scope: "workflow",
      isSystem: 0,
      permissions: ["workflow:view"],
    },
  ]);
  expect(await listWorkflowCustomRoles(actor, "workflow-a")).toMatchObject([
    {
      code: "custom_reader",
      isSystem: 0,
      permissions: ["workflow:view"],
      configToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  ]);
  expect(mocks.roles).toHaveBeenCalledWith("workflow");
});
it("绑定与撤销转交同一事务服务，传递完整登录会话和流程范围", async () => {
  const authenticated = { ...actor, tokenVersion: 3 };
  const grant = {
    workflowId: "workflow-a",
    userId: 2,
    roleCode: "custom_reader",
    expectedConfigToken: "a".repeat(64),
  };
  await assignWorkflowCustomRole(authenticated, grant);
  expect(mocks.assign).toHaveBeenCalledWith(authenticated, grant);
  const revoke = { workflowId: "workflow-a", assignmentId: "own-assignment" };
  await revokeWorkflowCustomRole(authenticated, revoke);
  expect(mocks.revoke).toHaveBeenCalledWith(authenticated, revoke);
});
it("绑定记录按当前流程查询并分页", async () => {
  mocks.query
    .mockResolvedValueOnce([[{ total: 12 }]])
    .mockResolvedValueOnce([[{ id: "own" }]]);
  expect(
    await listWorkflowRoleAssignments(actor, {
      workflowId: "workflow-a",
      page: 1,
      query: "张",
    })
  ).toMatchObject({ total: 12, page: 1, pageSize: 10 });
  expect(mocks.query.mock.calls[0][1][0]).toBe("workflow-a");
  expect(mocks.query.mock.calls[1][1].at(-1)).toBe(10);
});
