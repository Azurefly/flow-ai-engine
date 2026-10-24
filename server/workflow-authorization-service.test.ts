import { beforeEach, expect, it, vi } from "vitest";
import { customRoleConfigToken } from "./custom-role-configuration";
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
const selectedRole = {
  id: 19,
  code: "custom_reader",
  name: "流程阅读",
  description: null,
  scope: "workflow",
  isSystem: 0,
  permissions: ["workflow:view"],
};
function roleQueries(current = selectedRole, duplicate = false) {
  context.connection.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM iam_role WHERE code=")) return [[{ ...current }]];
    if (sql.includes("FROM role_permission"))
      return [
        current.permissions.map((_, index) => ({ permissionId: index + 1 })),
      ];
    if (sql.includes("SELECT code FROM permission"))
      return [current.permissions.map(code => ({ code }))];
    if (sql.includes("SELECT id FROM role_assignment"))
      return [duplicate ? [{ id: "existing" }] : []];
    return [{}];
  });
}
it("自定义绑定按确认快照锁定角色和权限，审计与业务使用同一连接", async () => {
  roleQueries();
  const token = customRoleConfigToken(selectedRole);
  await grantCustomWorkflowRole(actor, {
    ...input,
    expectedConfigToken: token,
  });
  expect(context.connection.query).toHaveBeenCalledWith(
    expect.stringContaining("FROM iam_role WHERE code=? LIMIT 1 FOR SHARE"),
    ["custom_reader"]
  );
  expect(context.connection.query).toHaveBeenCalledWith(
    expect.stringContaining(
      "FROM role_permission WHERE roleId=? ORDER BY permissionId FOR SHARE"
    ),
    [19]
  );
  expect(context.connection.query).toHaveBeenCalledWith(
    expect.stringContaining(
      "SELECT code FROM permission WHERE id IN (?) ORDER BY code FOR SHARE"
    ),
    [[1]]
  );
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      details: {
        roleCode: "custom_reader",
        roleConfigToken: token,
        permissionCodes: ["workflow:view"],
        expiresAt: null,
      },
    }),
    context.connection
  );
});
it.each([
  { id: 20 },
  { name: "已更名" },
  { description: "已更新说明" },
  { permissions: ["workflow:run"] },
])("角色实际配置变化时拒绝旧快照且不写入绑定或审计 %s", async changes => {
  roleQueries({ ...selectedRole, ...changes });
  await expect(
    grantCustomWorkflowRole(actor, {
      ...input,
      expectedConfigToken: customRoleConfigToken(selectedRole),
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    context.connection.query.mock.calls.some(([sql]: [string]) =>
      sql.startsWith("INSERT")
    )
  ).toBe(false);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("缺少确认快照时拒绝授权，不能以角色编码绕过所见配置确认", async () => {
  roleQueries();
  await expect(grantCustomWorkflowRole(actor, input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(
    context.connection.query.mock.calls.some(([sql]: [string]) =>
      sql.startsWith("INSERT")
    )
  ).toBe(false);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it.each([{ scope: "system" }, { isSystem: 1 }])(
  "不能绑定系统级或内置角色 %s",
  async changes => {
    roleQueries({ ...selectedRole, ...changes });
    await expect(
      grantCustomWorkflowRole(actor, {
        ...input,
        expectedConfigToken: customRoleConfigToken(selectedRole),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.audit).not.toHaveBeenCalled();
  }
);
it("确认配置后仍拒绝重复绑定和等待后失权", async () => {
  roleQueries(selectedRole, true);
  const submitted = {
    ...input,
    expectedConfigToken: customRoleConfigToken(selectedRole),
  };
  await expect(grantCustomWorkflowRole(actor, submitted)).rejects.toMatchObject(
    { code: "CONFLICT" }
  );
  roleQueries();
  context.recheck.mockRejectedValueOnce(new Error("lost"));
  await expect(grantCustomWorkflowRole(actor, submitted)).rejects.toThrow(
    "lost"
  );
  expect(
    context.connection.query.mock.calls.some(([sql]: [string]) =>
      sql.startsWith("INSERT")
    )
  ).toBe(false);
  expect(mocks.audit).not.toHaveBeenCalled();
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
