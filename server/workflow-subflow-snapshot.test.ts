import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  query: vi.fn(),
  access: vi.fn(),
  policy: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.pool,
    getConnection: async () => connection,
  }),
}));
vi.mock("./iam-service", () => ({
  getWorkflowAccess: mocks.access,
  hasSystemPermission: vi.fn(),
  recordAuthorizationAudit: mocks.audit,
}));
vi.mock("./p1-service", () => ({ isProjectApprovalRequired: mocks.policy }));
import {
  compileWorkflowDraft,
  updateWorkflow,
  validate,
  type Definition,
} from "./workflow-service";
import { withSubflowFlowType } from "../shared/subflow-profile";

const connection = {
  query: mocks.query,
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const user = { id: 7, role: "admin" };
const child = (value: string) =>
  withSubflowFlowType(
    validate(
      {
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
            config: { resultTemplate: value },
          },
        ],
        edges: [{ id: "edge", sourceNodeId: "start", targetNodeId: "end" }],
      },
      { flowType: "control", executable: true }
    ),
    "control"
  );
const stamp = "2026-10-20T00:00:00.000Z";
const parent = (snapshot = true) =>
  validate(
    {
      ...child("{{nodes.call.result.result}}"),
      settings: {},
      nodes: [
        child("placeholder").nodes.find(node => node.id === "start"),
        {
          id: "call",
          type: "subflow",
          name: "调用",
          position: { x: 120, y: 0 },
          config: {
            subflowId: "private_owned",
            executionMode: "sync_snapshot",
            zlcxz: { id: "private_owned", text: "私有A" },
            ...(snapshot
              ? {
                  resolvedSubflowId: "private_owned",
                  resolvedSubflowName: "私有A",
                  resolvedSubflowUpdatedAt: stamp,
                  resolvedSubflowDefinition: child("A"),
                }
              : {}),
          },
        },
        child("{{nodes.call.result.result}}").nodes.find(
          node => node.id === "end"
        ),
      ],
      edges: [
        { id: "a", sourceNodeId: "start", targetNodeId: "call" },
        { id: "b", sourceNodeId: "call", targetNodeId: "end" },
      ],
    },
    { flowType: "control", executable: false }
  );
let row: Record<string, unknown>, library: Record<string, unknown>;
const updated = () =>
  mocks.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE workflow SET"));
const stored = () => JSON.parse(updated()?.[1][1]) as Definition;
const config = (definition: Definition) =>
  definition.nodes.find(node => node.id === "call")!.config;
describe("项目审核固定私有子流程快照", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    row = {
      id: "parent_flow",
      ownerUserId: 7,
      projectId: "project_flow",
      projectStatus: "active",
      name: "父流程",
      status: "draft",
      auditStatus: "approved",
      definitionVersion: 3,
      flowType: "control",
      definitionJson: JSON.stringify(parent()),
      archivedAt: null,
    };
    library = {
      id: "private_owned",
      name: "私有B",
      updatedAt: new Date("2026-10-20T01:00:00Z"),
      definitionJson: JSON.stringify(child("B")),
      isEnabled: 1,
    };
    mocks.access.mockResolvedValue({
      permissions: new Set([
        "workflow:view",
        "workflow:edit",
        "workflow:publish",
      ]),
    });
    mocks.policy.mockResolvedValue(true);
    mocks.pool.mockImplementation(async (sql: string) => [
      sql.startsWith("SELECT w.*")
        ? [row]
        : sql.includes("workflow_subflow")
          ? [library]
          : [],
    ]);
    connection.rollback.mockResolvedValue(undefined);
    mocks.query.mockImplementation(async (sql: string) =>
      sql.startsWith("SELECT w.*")
        ? [[row]]
        : sql.startsWith("SELECT id,role,status")
          ? [[{ id: 7, role: "admin", status: "active" }]]
          : sql.includes("FROM flow_project")
            ? [[{ status: "active" }]]
            : sql.includes("FROM workflow WHERE")
              ? [[row]]
              : [{ affectedRows: 1 }]
    );
  });
  for (const supplied of [false, true])
    it(`发布${supplied ? "携带" : "省略"}定义时，个人库更新不替换已审核的 A`, async () => {
      await updateWorkflow("parent_flow", user, {
        publish: true,
        expectedDefinitionVersion: 3,
        ...(supplied ? { definition: parent() } : {}),
      });
      expect(config(stored()).resolvedSubflowDefinition).toEqual(child("A"));
      expect(config(stored()).resolvedSubflowName).toBe("私有A");
      expect(config(stored()).resolvedSubflowUpdatedAt).toBe(stamp);
      expect(updated()?.[1][4]).toBe(false);
      expect(connection.commit).toHaveBeenCalledTimes(1);
    });
  it("预检使用同一份已保存快照", async () => {
    const result = await compileWorkflowDraft("parent_flow", user, parent());
    expect(result?.ok).toBe(true);
    if (result?.ok)
      expect(config(result.definition).resolvedSubflowDefinition).toEqual(
        child("A")
      );
  });
  it("重新保存父流程更新到 B，并将审核重置为待审核", async () => {
    await updateWorkflow("parent_flow", user, {
      definition: parent(),
      expectedDefinitionVersion: 3,
    });
    expect(config(stored()).resolvedSubflowDefinition).toEqual(child("B"));
    expect(config(stored()).resolvedSubflowName).toBe("私有B");
    expect(updated()?.[1][4]).toBe(true);
    expect(updated()?.[1][3]).toBe(4);
  });
  it("旧草稿缺少快照时，即使发布不携带定义，也必须先保存再复核", async () => {
    row.definitionJson = JSON.stringify(parent(false));
    await expect(
      updateWorkflow("parent_flow", user, {
        publish: true,
        expectedDefinitionVersion: 3,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updated()).toBeUndefined();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("篡改已审核快照不能沿用旧审核结果", async () => {
    const forged = parent();
    config(forged).resolvedSubflowDefinition = child("未经复核");
    await expect(
      updateWorkflow("parent_flow", user, {
        publish: true,
        definition: forged,
        expectedDefinitionVersion: 3,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updated()).toBeUndefined();
  });
  it("快照必须绑定当前引用 ID，不能将其他引用的旧内容当作当前快照发布", async () => {
    const stale = parent();
    config(stale).resolvedSubflowId = "another_private";
    row.definitionJson = JSON.stringify(stale);
    await expect(
      updateWorkflow("parent_flow", user, {
        publish: true,
        expectedDefinitionVersion: 3,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updated()).toBeUndefined();
  });
  it("个人库已停用时仍禁止新发布；取消发布保留原快照", async () => {
    library.isEnabled = 0;
    await expect(
      updateWorkflow("parent_flow", user, {
        publish: true,
        expectedDefinitionVersion: 3,
      })
    ).rejects.toThrow("已启用");
    row.status = "published";
    await updateWorkflow("parent_flow", user, {
      unpublish: true,
      expectedDefinitionVersion: 3,
    });
    expect(config(stored()).resolvedSubflowDefinition).toEqual(child("A"));
  });
  it("首次保存会捕获快照，而无定义的名称或生命周期操作不刷新它", async () => {
    row.definitionJson = JSON.stringify(parent(false));
    await updateWorkflow("parent_flow", user, {
      definition: parent(false),
      expectedDefinitionVersion: 3,
    });
    expect(config(stored()).resolvedSubflowDefinition).toEqual(child("B"));
    mocks.query.mockClear();
    mocks.pool.mockClear();
    row.definitionJson = JSON.stringify(parent());
    await updateWorkflow("parent_flow", user, {
      name: "新名称",
      expectedDefinitionVersion: 3,
    });
    expect(config(stored()).resolvedSubflowDefinition).toEqual(child("A"));
    expect(
      mocks.pool.mock.calls.some(([sql]) => sql.includes("workflow_subflow"))
    ).toBe(false);
  });
});
