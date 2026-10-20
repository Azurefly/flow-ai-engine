import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  query: vi.fn(),
  policy: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({ getWorkflowAccess: mocks.access }));
vi.mock("./p1-service", () => ({ isProjectApprovalRequired: mocks.policy }));
import { getWorkflowPublicationAccess } from "./workflow-publication-access";
const user = { id: 7, role: "user" as const };
const row = {
  id: "flow",
  projectId: "project",
  definitionVersion: 3,
  status: "draft",
  auditStatus: "init",
  archivedAt: null,
  projectStatus: "active",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set([
      "workflow:view",
      "workflow:publish",
      "workflow:edit",
    ]),
    memberRoles: [],
    projectRoles: ["designer"],
  });
  mocks.query.mockResolvedValue([[row]]);
  mocks.policy.mockResolvedValue(true);
});
it.each([true, false])(
  "使用实际审批开关 %s，仅返回轻量发布元数据",
  async required => {
    mocks.policy.mockResolvedValue(required);
    const result = await getWorkflowPublicationAccess(user, "flow");
    expect(result.publication).toEqual({
      workflowId: "flow",
      definitionVersion: 3,
      status: "draft",
      auditStatus: "init",
      projectScoped: true,
      archived: false,
      requireProjectApproval: required,
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.not.stringContaining("definitionJson"),
      ["flow"]
    );
    expect(mocks.policy).toHaveBeenCalledTimes(1);
  }
);
it("无查看或发布权限不读取流程元数据与全局规则", async () => {
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["workflow:view"]),
  });
  expect(
    (await getWorkflowPublicationAccess(user, "flow")).publication
  ).toBeNull();
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.policy).not.toHaveBeenCalled();
});
it("独立流程无需读取业务审批配置", async () => {
  mocks.query.mockResolvedValue([
    [{ ...row, projectId: null, projectStatus: null }],
  ]);
  expect(
    (await getWorkflowPublicationAccess(user, "flow")).publication
  ).toMatchObject({
    projectScoped: false,
    requireProjectApproval: false,
    archived: false,
  });
  expect(mocks.policy).not.toHaveBeenCalled();
});
it("规则读取失败只暂停发布，不丢弃已读取的查看与编辑权限", async () => {
  mocks.policy.mockRejectedValue(new Error("policy unavailable"));
  const result = await getWorkflowPublicationAccess(user, "flow");
  expect(result.publication).toBeNull();
  expect(result.permissions.has("workflow:edit")).toBe(true);
});
it("归档状态可追溯到业务与流程，不受旧列表缓存影响", async () => {
  mocks.query.mockResolvedValue([[{ ...row, projectStatus: "archived" }]]);
  expect(
    (await getWorkflowPublicationAccess(user, "flow")).publication?.archived
  ).toBe(true);
});
it("不存在或版本异常的流程不回退到其他资源", async () => {
  mocks.query.mockResolvedValue([[]]);
  expect(
    (await getWorkflowPublicationAccess(user, "flow")).publication
  ).toBeNull();
  mocks.query.mockResolvedValue([[{ ...row, definitionVersion: 0 }]]);
  expect(
    (await getWorkflowPublicationAccess(user, "flow")).publication
  ).toBeNull();
  expect(mocks.policy).not.toHaveBeenCalled();
});
