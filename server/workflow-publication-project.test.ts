import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  permissions: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  getProjectWorkflowPermissions: mocks.permissions,
  recordAuthorizationAudit: vi.fn(),
  hasSystemPermission: vi.fn(),
}));
vi.mock("./p1-service", () => ({ getP1SystemSettings: mocks.settings }));
import { listProjectWorkflows } from "./project-service";
const user = { id: 7, role: "user" as const };
let memberRole = "designer",
  rows: any[];
beforeEach(() => {
  vi.resetAllMocks();
  memberRole = "designer";
  rows = ["state", "control", "data"].map((flowType, index) => ({
    id: "flow" + index,
    projectId: "project",
    projectStatus: "active",
    ownerUserId: 8,
    status: "draft",
    auditStatus: "init",
    definitionVersion: 2,
    flowType,
    name: flowType,
    definitionJson: '{"nodes":[],"edges":[]}',
  }));
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT ownerUserId,status FROM flow_project"))
      return [[{ ownerUserId: 8, status: "active" }]];
    if (sql.includes("FROM flow_project_member WHERE"))
      return [[{ role: memberRole }]];
    if (sql.includes("SELECT w.*,u.username")) return [rows];
    return [[]];
  });
  mocks.permissions.mockImplementation(
    async () =>
      new Map(
        rows.map(row => [
          row.id,
          new Set(
            memberRole === "viewer"
              ? ["workflow:view"]
              : ["workflow:view", "workflow:edit", "workflow:publish"]
          ),
        ])
      )
  );
  mocks.settings.mockResolvedValue({
    approval: {
      reviewerMode: "independent_reviewer",
      requireProjectApproval: false,
    },
  });
});
it("三类流程共享一次规则读取，设计者无需管理权限也取得正确的发布入口", async () => {
  const result = await listProjectWorkflows(user, "project");
  expect(result).toHaveLength(3);
  expect(result.every(row => row.actions.canPublish)).toBe(true);
  expect(
    result.every(
      row => row.actions.publicationRule?.requireProjectApproval === false
    )
  ).toBe(true);
  expect(mocks.settings).toHaveBeenCalledTimes(1);
});
it("审批开启时三类待审核草稿均不开放发布", async () => {
  mocks.settings.mockResolvedValue({
    approval: {
      reviewerMode: "independent_reviewer",
      requireProjectApproval: true,
    },
  });
  const result = await listProjectWorkflows(user, "project");
  expect(
    result.every(
      row =>
        !row.actions.canPublish &&
        row.actions.publishBlockedReason?.includes("审核")
    )
  ).toBe(true);
});
it("规则读取失败保留查看、设计与原行数据，仅暂停发布", async () => {
  mocks.settings.mockRejectedValue(new Error("read failure"));
  const result = await listProjectWorkflows(user, "project");
  expect(result).toHaveLength(3);
  expect(
    result.every(
      row =>
        row.actions.canViewCanvas &&
        row.actions.canDesign &&
        !row.actions.canPublish
    )
  ).toBe(true);
  expect(result[0].actions.publishBlockedReason).toContain("暂不可用");
});
it("纯查看者与空列表不增加全局配置读取", async () => {
  memberRole = "viewer";
  const result = await listProjectWorkflows(user, "project");
  expect(
    result.every(
      row => !row.actions.canPublish && row.actions.publicationRule === null
    )
  ).toBe(true);
  expect(mocks.settings).not.toHaveBeenCalled();
  rows = [];
  expect(await listProjectWorkflows(user, "project")).toEqual([]);
  expect(mocks.settings).not.toHaveBeenCalled();
});
