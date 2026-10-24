import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), permission: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: mocks.permission,
  recordAuthorizationAudit: vi.fn(),
}));
vi.mock("./workflow-engine", () => ({
  resumeWorkflowTask: vi.fn(),
  validateWorkflowTaskSubmission: vi.fn(),
}));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));
import {
  getWorkflowTask,
  listWorkflowTasks,
  pageWorkflowTasks,
} from "./p1-service";
const user = { id: 7, role: "user" as const };
const row = (extra: Record<string, unknown> = {}) => ({
  id: "task-1",
  workflowId: "workflow-1",
  projectId: "project-1",
  runId: "run-1",
  nodeId: "node-1",
  executionKey: "iteration-2",
  status: "pending",
  assignedUserId: 7,
  candidateUserIdsJson: [7, 8],
  runStatus: "waiting",
  createdAt: new Date("2026-10-24T00:00:00Z"),
  cursorCreatedAt: "2026-10-24 00:00:00.000000",
  resultJson: null,
  ...extra,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue([[]]);
  mocks.permission.mockResolvedValue(false);
});
describe("任务列表按需加载与运行筛选", () => {
  it("分页使用轻量SQL并同时绑定项目和运行，不把筛选值拼入SQL", async () => {
    mocks.query.mockResolvedValueOnce([[row()]]);
    const result = await pageWorkflowTasks(user, {
      view: "todo",
      projectId: "project-1",
      runId: "run-1",
      limit: 10,
    });
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).not.toContain("SELECT t.*");
    expect(sql).not.toContain("t.participantSnapshotJson");
    expect(sql).not.toContain("t.outcomeHandlesJson");
    expect(sql).toContain("t.projectId=? AND t.runId=?");
    expect(params).toContain("project-1");
    expect(params).toContain("run-1");
    expect(sql).not.toContain("project-1");
    expect(sql).not.toContain("run-1");
    expect(result.items[0]).toMatchObject({
      id: "task-1",
      executionKey: "iteration-2",
      canAct: true,
      candidateUserIds: [7, 8],
    });
    expect(result.items[0].payload).toBeUndefined();
  });
  it.each([true, false])(
    "轻量分页仍检查未分派给当前人的流程查看权限 %s",
    async visible => {
      mocks.query.mockResolvedValueOnce([
        [row({ assignedUserId: 99, candidateUserIdsJson: [99] })],
      ]);
      mocks.permission.mockResolvedValue(visible);
      const result = await pageWorkflowTasks(user, {
        view: "all",
        runId: "run-1",
        limit: 10,
      });
      expect(result.items.length).toBe(visible ? 1 : 0);
      expect(mocks.permission).toHaveBeenCalledWith(
        user,
        "workflow-1",
        "workflow:view"
      );
      if (visible) expect(result.items[0].canAct).toBe(false);
    }
  );
  it.each([1, 0])("轻量数据保留排队并行任务办理判定 %s", async parallel => {
    mocks.query.mockResolvedValueOnce([
      [row({ runStatus: "queued", hasParallelContinuation: parallel })],
    ]);
    const result = await pageWorkflowTasks(user, { view: "todo", limit: 10 });
    expect(result.items[0].canAct).toBe(parallel === 1);
  });
  it("摘要保留拒绝决定与签署进度", async () => {
    mocks.query.mockResolvedValueOnce([
      [
        row({
          status: "completed",
          approvalGroupId: "group-1",
          resultJson: { decision: "rejected", outcome: "rejected" },
          totalApprovers: 2,
          requiredApprovals: 2,
          completedDecisions: 1,
          rejectedApprovals: 1,
          approvedApprovals: 0,
        }),
      ],
    ]);
    const result = await pageWorkflowTasks(user, { view: "done", limit: 10 });
    expect(result.items[0]).toMatchObject({
      displayStatus: "已拒绝",
      canAct: false,
      approvalProgress: { total: 2, required: 2, decided: 1, rejected: 1 },
    });
  });
  it("兼容列表可显式读取摘要并保留运行筛选", async () => {
    mocks.query.mockResolvedValueOnce([[row()]]);
    await listWorkflowTasks(user, {
      view: "todo",
      projectId: "project-1",
      runId: "run-1",
      summaryOnly: true,
    });
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).not.toContain("SELECT t.*");
    expect(sql).toContain("t.runId=?");
    expect(params).toContain("run-1");
  });
  it("既有列表调用继续保留完整载荷", async () => {
    mocks.query.mockResolvedValueOnce([
      [
        row({
          payloadJson: {
            config: {
              formSchema: {
                fields: [
                  {
                    key: "reference",
                    readOnly: true,
                    defaultValue: "固定编号",
                  },
                ],
              },
            },
          },
        }),
      ],
    ]);
    const result = await listWorkflowTasks(user, { view: "todo" });
    expect(mocks.query.mock.calls[0][0]).toContain("SELECT t.*");
    expect(result[0].payload.config.formSchema.fields[0].defaultValue).toBe(
      "固定编号"
    );
  });
  it("摘要筛选仍不泄露不可见任务", async () => {
    mocks.query.mockResolvedValueOnce([
      [row({ assignedUserId: 99, candidateUserIdsJson: [99] })],
    ]);
    const result = await listWorkflowTasks(user, {
      view: "all",
      runId: "run-1",
      summaryOnly: true,
    });
    expect(result).toEqual([]);
  });
  it("抽屉详情继续返回完整表单、结果分支和提交值", async () => {
    mocks.query.mockResolvedValueOnce([
      [
        row({
          payloadJson: {
            config: {
              formSchema: { fields: [{ key: "reportNote", required: true }] },
            },
          },
          outcomeHandlesJson: {
            mode: "explicit",
            handles: { approved: "cmd01" },
          },
          resultJson: { decision: "approved", reportNote: "已核对" },
        }),
      ],
    ]);
    mocks.permission.mockImplementation(
      async (_u, _w, code) => code === "workflow:view"
    );
    const result = await getWorkflowTask(user, "task-1");
    expect(mocks.query.mock.calls[0][0]).toContain("SELECT t.*");
    expect(result).toMatchObject({
      payload: {
        config: {
          formSchema: { fields: [{ key: "reportNote", required: true }] },
        },
      },
      outcomeHandlesJson: { handles: { approved: "cmd01" } },
      result: { reportNote: "已核对" },
    });
  });
});
