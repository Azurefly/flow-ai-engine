import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  manage: vi.fn(),
  access: vi.fn(),
  project: vi.fn(),
  sources: vi.fn(),
  task: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.connect }),
}));
vi.mock("./iam-service", async () => ({
  ...(await vi.importActual<typeof import("./iam-service")>("./iam-service")),
  ensureIamCatalog: vi.fn(),
  hasSystemPermission: mocks.manage,
  getWorkflowAccess: mocks.access,
  assignedPermissionSources: mocks.sources,
}));
vi.mock("./project-service", async () => ({
  ...(await vi.importActual<typeof import("./project-service")>(
    "./project-service"
  )),
  getProjectAccess: mocks.project,
}));
vi.mock("./p1-service", () => ({
  inspectWorkflowTaskAction: mocks.task,
  isProjectApprovalRequired: vi.fn(),
  getP1SystemSettings: vi.fn(),
}));
import { diagnoseResourceAccess } from "./resource-access-diagnostics";
const connection = {
  query: mocks.query,
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
let user: Record<string, unknown>,
  resource: Record<string, unknown>,
  bindings: any[];
beforeEach(() => {
  vi.clearAllMocks();
  user = {
    id: 7,
    name: "待核对人员",
    username: "person",
    role: "user",
    status: "active",
  };
  resource = {
    id: "workflow-1",
    name: "申请",
    flowType: "state",
    projectId: "project-1",
    ownerUserId: 8,
    projectOwnerUserId: 8,
  };
  bindings = [];
  mocks.connect.mockResolvedValue(connection);
  mocks.manage.mockResolvedValue(true);
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["workflow:view"]),
    memberRoles: [],
    projectRoles: [],
  });
  mocks.project.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:view"]),
    roles: [],
  });
  mocks.sources.mockResolvedValue([
    { code: "workflow:view", sourceKind: "direct", roleName: "查看者" },
  ]);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SET TRANSACTION")) return [[]];
    if (sql.includes("FROM users WHERE")) return [[user]];
    if (sql.includes("FROM workflow w LEFT JOIN")) return [[resource]];
    if (sql.includes("FROM role_assignment ra")) return [bindings];
    if (
      sql.includes("FROM workflow_member") ||
      sql.includes("FROM flow_project_member") ||
      sql.includes("FROM flow_project_unit") ||
      sql.includes("WITH RECURSIVE")
    )
      return [[]];
    throw new Error("Unexpected query");
  });
});
const actor = { id: 1, role: "admin" as const },
  input = { userId: 7, workflowId: "workflow-1" };
it("仅身份管理员能诊断其他人，拒绝时不读取资源", async () => {
  mocks.manage.mockResolvedValue(false);
  await expect(diagnoseResourceAccess(actor, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("使用同一只读快照和真实权限读取器，来源记录不能自行授予权限", async () => {
  bindings = [{ kind: "直接角色", roleName: "运行者", state: "有效" }];
  const value = await diagnoseResourceAccess(actor, input);
  expect(value.checks.find(p => p.code === "workflow:view")).toMatchObject({
    allowed: true,
    sources: ["直接角色 · 查看者"],
  });
  expect(value.checks.find(p => p.code === "workflow:run")?.allowed).toBe(
    false
  );
  expect(mocks.access).toHaveBeenCalledWith(
    { id: 7, role: "user" },
    "workflow-1",
    { connection }
  );
  expect(mocks.query.mock.calls[0][0]).toContain("READ ONLY");
  expect(connection.commit).toHaveBeenCalledOnce();
  expect(connection.release).toHaveBeenCalledOnce();
});
it("停用管理员账号也没有当前有效权限，不能误用内置管理员绕过", async () => {
  user.role = "admin";
  user.status = "disabled";
  mocks.access.mockResolvedValue({
    permissions: new Set(["workflow:view", "workflow:run"]),
  });
  const value = await diagnoseResourceAccess(actor, {
    ...input,
    taskId: "task-1234",
  });
  expect(value.checks.every(p => !p.allowed)).toBe(true);
  expect(value.task?.canAct).toBe(false);
  expect(mocks.task).not.toHaveBeenCalled();
});
it("数据流程发起以业务运行权限为准，单独流程运行角色不足", async () => {
  resource.flowType = "data";
  mocks.access.mockResolvedValue({ permissions: new Set(["workflow:run"]) });
  expect(
    (await diagnoseResourceAccess(actor, input)).checks.find(
      p => p.code === "workflow:run"
    )?.allowed
  ).toBe(false);
  mocks.project.mockResolvedValue({
    permissions: new Set(["project:workflow:run"]),
  });
  expect(
    (await diagnoseResourceAccess(actor, input)).checks.find(
      p => p.code === "workflow:run"
    )?.allowed
  ).toBe(true);
});
it("保留过期和撤销记录供排查，实际权限按当前授权读取器重新计算", async () => {
  bindings = [
    { kind: "直接角色", roleName: "查看者", state: "已过期" },
    { kind: "直接角色", roleName: "运行者", state: "已撤销" },
  ];
  mocks.access.mockResolvedValue({ permissions: new Set() });
  const value = await diagnoseResourceAccess(actor, input);
  expect(value.checks.every(p => !p.allowed)).toBe(true);
  expect(value.bindings).toMatchObject(bindings);
});
it("任务办理资格委托给真实任务守卫，并绑定被诊断流程", async () => {
  mocks.task.mockResolvedValue({
    id: "task-1234",
    canAct: false,
    reason: "等待前序审批",
  });
  const value = await diagnoseResourceAccess(actor, {
    ...input,
    taskId: "task-1234",
  });
  expect(mocks.task).toHaveBeenCalledWith(
    { id: 7, role: "user" },
    "task-1234",
    "workflow-1"
  );
  expect(value.task?.reason).toBe("等待前序审批");
});
it("数据库读取失败回滚并释放连接，不呈现为未授权", async () => {
  mocks.access.mockRejectedValueOnce(new Error("read failed"));
  await expect(diagnoseResourceAccess(actor, input)).rejects.toThrow(
    "read failed"
  );
  expect(connection.rollback).toHaveBeenCalledOnce();
  expect(connection.release).toHaveBeenCalledOnce();
});
