import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ commit: vi.fn(), audit: vi.fn() }));
vi.mock("./workflow-authorization-transaction", () => ({
  commitWorkflowAuthorization: mocks.commit,
}));
vi.mock("./iam-service", () => ({
  recordAuthorizationAudit: mocks.audit,
  validateRoleCode: (value: string) => value,
}));
import {
  grantBuiltinWorkflowRole,
  revokeBuiltinWorkflowRole,
  grantCustomWorkflowRole,
  revokeCustomWorkflowRole,
} from "./workflow-authorization-service";
const actor = { id: 7, tokenVersion: 1 },
  input = {
    workflowId: "flow",
    userId: 3,
    role: "viewer" as const,
    roleCode: "custom_reader",
  };
let context: any;
beforeEach(() => {
  vi.resetAllMocks();
  context = {
    connection: {
      query: vi
        .fn()
        .mockResolvedValue([
          [{ id: "grant", userId: 3, roleCode: "custom_reader" }],
        ]),
    },
    target: { status: "active" },
    creator: { status: "active" },
    workflow: { ownerUserId: 5 },
    recheck: vi.fn(),
  };
  mocks.commit.mockImplementation(async (_actor, _flow, _target, write) =>
    write(context)
  );
});
it.each([
  grantBuiltinWorkflowRole,
  revokeBuiltinWorkflowRole,
  revokeCustomWorkflowRole,
])("业务写和审计使用同一连接 %s", async operation => {
  await operation(actor, { ...input, assignmentId: "grant" });
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      actorUserId: 7,
      resourceType: "workflow",
      resourceId: "flow",
    }),
    context.connection
  );
  expect(context.recheck).toHaveBeenCalledOnce();
});
it("自定义绑定锁定角色、排除重复、审计同连接", async () => {
  context.connection.query
    .mockResolvedValueOnce([[{ id: 19 }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValue([{}]);
  await grantCustomWorkflowRole(actor, input);
  expect(context.connection.query).toHaveBeenCalledWith(
    expect.stringContaining("FOR SHARE"),
    ["custom_reader"]
  );
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      details: { roleCode: "custom_reader", expiresAt: null },
    }),
    context.connection
  );
});
it.each([grantBuiltinWorkflowRole, grantCustomWorkflowRole])(
  "停用目标不可授权 %s",
  async operation => {
    context.target.status = "disabled";
    await expect(operation(actor, input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  }
);
it("创建者所有者身份明确受保护", async () => {
  await expect(
    revokeBuiltinWorkflowRole(actor, { ...input, userId: 5, role: "owner" })
  ).rejects.toThrow("创建者身份");
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("创建者停用时不能移除最后有效委托所有者", async () => {
  context.creator.status = "disabled";
  context.connection.query
    .mockResolvedValueOnce([[{ id: "grant", effective: 1 }]])
    .mockResolvedValueOnce([[]]);
  await expect(
    revokeBuiltinWorkflowRole(actor, { ...input, role: "owner" })
  ).rejects.toThrow("至少一位有效所有者");
  expect(context.connection.query.mock.calls[1][0]).toContain(
    "u.status='active'"
  );
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("不存在或已撤销的自定义绑定不跨流程修改", async () => {
  context.connection.query.mockResolvedValue([[]]);
  await expect(
    revokeCustomWorkflowRole(actor, {
      workflowId: "flow",
      assignmentId: "other",
    })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("等待锁后再次校验权限和有效期", async () => {
  context.recheck.mockRejectedValueOnce(new Error("lost"));
  await expect(grantBuiltinWorkflowRole(actor, input)).rejects.toThrow("lost");
  expect(mocks.audit).not.toHaveBeenCalled();
  await expect(
    grantBuiltinWorkflowRole(actor, { ...input, expiresAt: new Date(0) })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
