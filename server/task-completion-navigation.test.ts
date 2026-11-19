import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  permission: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: mocks.permission,
  recordAuthorizationAudit: vi.fn(),
}));
vi.mock("./workflow-engine", async importOriginal => ({
  ...(await importOriginal<typeof import("./workflow-engine")>()),
  resumeWorkflowTask: mocks.resume,
}));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));
import { completeWorkflowTask, executeWorkflowTask } from "./p1-service";
beforeEach(() => vi.resetAllMocks());
it.each([false, true])(
  "完成任务返回本人实例查看权限 %s，办理权限仍独立校验",
  async canViewRun => {
    mocks.permission.mockImplementation(
      async (_user, _workflowId, permission) =>
        permission === "workflow:view" && canViewRun
    );
    mocks.query
      .mockResolvedValueOnce([
        [
          {
            id: "task-1",
            workflowId: "flow-1",
            runId: "run-1",
            nodeId: "operate",
            assignedUserId: 12,
            claimedByUserId: 12,
            status: "claimed",
            runStatus: "waiting",
          },
        ],
      ])
      .mockResolvedValueOnce([[{ status: "active" }]])
      .mockResolvedValueOnce([
        [
          {
            sourceNodeId: "operate",
            availableOperationsJson: JSON.stringify([{ taskId: "task-1" }]),
          },
        ],
      ]);
    mocks.resume.mockResolvedValue({ runId: "run-1", status: "queued" });
    await expect(
      completeWorkflowTask({ id: 12, role: "user" }, "task-1", {
        decision: "approved",
      })
    ).resolves.toEqual({ runId: "run-1", status: "queued", canViewRun });
    expect(mocks.permission).toHaveBeenCalledWith(
      { id: 12, role: "user" },
      "flow-1",
      "workflow:view"
    );
    expect(mocks.resume).toHaveBeenCalledTimes(1);
  }
);
it.each(["pending", "claimed"])("授权处理人提交 %s 任务时，暂停返回可恢复冲突并保留任务", async status => {
  const task = { id: "task-1", workflowId: "flow-1", runId: "run-1", nodeId: "operate",
    assignedUserId: 12, claimedByUserId: status === "claimed" ? 12 : null, status, runStatus: "blocked" };
  mocks.query.mockResolvedValueOnce([[task]]).mockResolvedValueOnce([[{ status: "active" }]]);
  const submit = status === "claimed" ? completeWorkflowTask : executeWorkflowTask;
  await expect(submit({ id: 12, role: "user" }, task.id, { decision: "approved" })).rejects.toMatchObject({
    code: "CONFLICT", message: expect.stringMatching(/已暂停.*恢复.*重新提交/),
  });
  expect(mocks.resume).not.toHaveBeenCalled();
  expect(mocks.query.mock.calls.every(([sql]) => String(sql).trimStart().startsWith("SELECT"))).toBe(true);
});
it("可查看其他人任务的账号不能通过提交读取暂停详情", async () => {
  mocks.permission.mockResolvedValue(true);
  mocks.query.mockResolvedValueOnce([[{ id: "task-1", workflowId: "flow-1", runId: "run-1",
    status: "pending", runStatus: "blocked", assignedUserId: 12 }]]);
  await expect(executeWorkflowTask({ id: 13, role: "user" }, "task-1", { decision: "approved" }))
    .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.not.stringContaining("暂停") });
  expect(mocks.resume).not.toHaveBeenCalled();
});
it("已授权办理人缺少表单必填字段时保留原始字段提示且不领取任务", async () => {
  mocks.query.mockResolvedValueOnce([[{
    id: "task-1", workflowId: "flow-1", runId: "run-1", nodeId: "operate", assignedUserId: 12,
    status: "pending", runStatus: "waiting", payloadJson: { config: {
      formSchema: { fields: [{ key: "reviewNote", type: "text", required: true }] },
    } },
  }]]).mockResolvedValueOnce([[{ status: "active" }]])
    .mockResolvedValueOnce([[{ sourceNodeId: "operate", availableOperationsJson: JSON.stringify([{ taskId: "task-1" }]) }]]);
  await expect(executeWorkflowTask({ id: 12, role: "user" }, "task-1", { decision: "approved" }))
    .rejects.toMatchObject({ code: "BAD_REQUEST", message: "表单必填字段“reviewNote”缺失。" });
  expect(mocks.resume).not.toHaveBeenCalled();
  expect(mocks.query.mock.calls.every(([sql]) => String(sql).trimStart().startsWith("SELECT"))).toBe(true);
});
