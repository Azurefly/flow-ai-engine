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
  assignRole: mocks.assign,
  revokeRoleAssignment: mocks.revoke,
  validateRoleCode: (code: string) => {
    if (!code.startsWith("custom_")) throw new Error("非法编码");
    return code;
  },
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
    { code: "custom_reader", isSystem: 0, permissions: ["workflow:view"] },
  ]);
  expect(await listWorkflowCustomRoles(actor, "workflow-a")).toMatchObject([
    { code: "custom_reader", isSystem: 0, permissions: ["workflow:view"] },
  ]);
  expect(mocks.roles).toHaveBeenCalledWith("workflow");
});
it("绑定固定当前流程作用域和操作者", async () => {
  mocks.query.mockResolvedValue([[{ id: 31 }]]);
  await assignWorkflowCustomRole(actor, {
    workflowId: "workflow-a",
    userId: 2,
    roleCode: "custom_reader",
  });
  expect(mocks.assign).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 2,
      roleCode: "custom_reader",
      scopeType: "workflow",
      scopeId: "workflow-a",
      grantedByUserId: 17,
    })
  );
});
it("系统或不存在的角色不能绑定", async () => {
  mocks.query.mockResolvedValue([[]]);
  await expect(
    assignWorkflowCustomRole(actor, {
      workflowId: "workflow-a",
      userId: 2,
      roleCode: "custom_reader",
    })
  ).rejects.toThrow("请选择自定义流程角色");
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("其他流程的授权不可从当前流程撤销", async () => {
  mocks.query.mockResolvedValue([[]]);
  await expect(
    revokeWorkflowCustomRole(actor, {
      workflowId: "workflow-a",
      assignmentId: "other-assignment",
    })
  ).rejects.toThrow("不能撤销其他流程");
  expect(mocks.query.mock.calls[0][1]).toMatchObject([
    "other-assignment",
    "workflow-a",
  ]);
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it("当前流程自定义授权可以撤销且保留审计操作者", async () => {
  mocks.query.mockResolvedValue([[{ id: "own-assignment" }]]);
  await revokeWorkflowCustomRole(actor, {
    workflowId: "workflow-a",
    assignmentId: "own-assignment",
  });
  expect(mocks.revoke).toHaveBeenCalledWith({
    assignmentId: "own-assignment",
    revokedByUserId: 17,
  });
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
