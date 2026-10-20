import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  query: vi.fn(),
  getConnection: vi.fn(),
  access: vi.fn(),
  audit: vi.fn(),
  policy: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.poolQuery,
    getConnection: mocks.getConnection,
  }),
}));
vi.mock("./iam-service", () => ({
  getWorkflowAccess: mocks.access,
  hasSystemPermission: vi.fn(),
  recordAuthorizationAudit: mocks.audit,
}));
vi.mock("./p1-service", () => ({ isProjectApprovalRequired: mocks.policy }));
import { updateWorkflow } from "./workflow-service";

const definition = {
  schemaVersion: 1,
  settings: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      position: { x: 240, y: 0 },
      config: {},
    },
  ],
  edges: [{ id: "edge", sourceNodeId: "start", targetNodeId: "end" }],
};
const original = {
  id: "workflow_review",
  ownerUserId: 7,
  projectId: "project_review",
  name: "发布复核",
  flowType: "control",
  status: "draft",
  auditStatus: "approved",
  definitionVersion: 2,
  definitionJson: JSON.stringify(definition),
  projectStatus: "active",
  archivedAt: null,
};
const connection = {
  query: mocks.query,
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
let firstRead: Record<string, unknown>, lockedRead: Record<string, unknown>;
describe("发布事务重新确认审核状态", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    firstRead = { ...original };
    lockedRead = { ...original };
    mocks.access.mockResolvedValue({
      permissions: new Set([
        "workflow:view",
        "workflow:publish",
        "workflow:edit",
      ]),
    });
    mocks.poolQuery.mockImplementation(async (sql: string) =>
      sql.startsWith("SELECT w.*") ? [[firstRead]] : [[]]
    );
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM flow_project"))
        return [[{ id: original.projectId, status: "active" }]];
      if (sql.includes("FROM workflow WHERE")) return [[lockedRead]];
      return [{ affectedRows: 1 }];
    });
    mocks.getConnection.mockResolvedValue(connection);
    mocks.policy.mockResolvedValue(true);
  });
  it("读取后被驳回，即使定义版本未变，也不能按缓存的通过状态发布", async () => {
    lockedRead.auditStatus = "rejected";
    await expect(
      updateWorkflow(
        original.id,
        { id: 7, role: "admin" },
        { publish: true, expectedDefinitionVersion: 2 }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.policy).toHaveBeenCalledWith(connection);
    expect(
      mocks.query.mock.calls.find(([sql]) =>
        sql.includes("FROM workflow WHERE")
      )?.[0]
    ).toContain("auditStatus");
    expect(
      mocks.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))
    ).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("以锁定后的通过状态发布，同时读取当前事务的审批规则", async () => {
    firstRead.auditStatus = "init";
    await updateWorkflow(
      original.id,
      { id: 7, role: "admin" },
      { publish: true, expectedDefinitionVersion: 2 }
    );
    expect(mocks.policy).toHaveBeenCalledTimes(1);
    expect(mocks.policy).toHaveBeenCalledWith(connection);
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        sql.startsWith("UPDATE workflow SET")
      )
    ).toBe(true);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });
  it("当前规则不要求审核时仍允许合法发布", async () => {
    firstRead.auditStatus = "init";
    lockedRead.auditStatus = "init";
    mocks.policy.mockResolvedValue(false);
    await updateWorkflow(
      original.id,
      { id: 7, role: "admin" },
      { publish: true, expectedDefinitionVersion: 2 }
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });
  it("版本已变化时不执行发布或审核查询", async () => {
    lockedRead.definitionVersion = 3;
    await expect(
      updateWorkflow(
        original.id,
        { id: 7, role: "admin" },
        { publish: true, expectedDefinitionVersion: 2 }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });
  it("取消发布不受审核门槛阻塞", async () => {
    firstRead.status = "published";
    lockedRead.status = "published";
    lockedRead.auditStatus = "rejected";
    await updateWorkflow(
      original.id,
      { id: 7, role: "admin" },
      { unpublish: true, expectedDefinitionVersion: 2 }
    );
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });
  it("取消发布不重新解析私有子流程，保留已存定义且不受引用删除阻塞", async () => {
    const saved = { ...definition, nodes: [...definition.nodes, { id: "private", type: "subflow", name: "已保存引用", position: { x: 120, y: 0 }, config: { subflowId: "removed_private", executionMode: "sync_snapshot", resolvedSubflowDefinition: definition } }] };
    firstRead.status = "published";
    firstRead.definitionJson = JSON.stringify(saved);
    lockedRead.status = "published";
    await updateWorkflow(original.id, { id: 7, role: "admin" }, { unpublish: true, expectedDefinitionVersion: 2 });
    expect(mocks.poolQuery.mock.calls.some(([sql]) => sql.includes("workflow_subflow"))).toBe(false);
    const update = mocks.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE workflow SET"));
    expect(JSON.parse(update?.[1][1])).toEqual(saved);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });
});
