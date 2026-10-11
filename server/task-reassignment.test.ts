import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  txQuery: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  audit: vi.fn(),
  permission: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: async () => connection,
  }),
}));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: mocks.permission,
  recordAuthorizationAudit: mocks.audit,
}));
vi.mock("./workflow-engine", () => ({ resumeWorkflowTask: vi.fn() }));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));
import {
  currentTaskHandlerIds,
  getWorkflowTask,
  reassignWorkflowTask,
} from "./p1-service";

const connection = {
  query: mocks.txQuery,
  beginTransaction: vi.fn(),
  commit: mocks.commit,
  rollback: mocks.rollback,
  release: vi.fn(),
};
const manager = { id: 99, role: "user" as const };
let task: any,
  staged: any,
  manageAllowed: boolean,
  ownerActive: boolean,
  reactivated: boolean,
  targetActive: boolean,
  runStatus: string,
  duplicate: boolean;
const input = {
  taskId: "task",
  targetUserId: 12,
  ownerVersion: 4,
  reason: "人员停用后交接",
};
beforeEach(() => {
  vi.clearAllMocks();
  task = {
    id: "task",
    workflowId: "flow",
    runId: "run",
    runStatus: "waiting",
    nodeId: "review",
    nodeName: "审核",
    status: "claimed",
    assignedUserId: 7,
    claimedByUserId: 7,
    candidateUserIdsJson: "[7]",
    ownerVersion: 4,
    payloadJson: JSON.stringify({
      config: { formSchema: { fields: [] } },
      context: { input: { reference: "保留" } },
    }),
    roleKey: "branch:a",
  };
  staged = null;
  manageAllowed = true;
  ownerActive = false;
  reactivated = false;
  targetActive = true;
  runStatus = "waiting";
  duplicate = false;
  mocks.permission.mockImplementation(
    async (user: any, _flow: string, permission: string) =>
      permission === "workflow:view" ||
      (permission === "workflow:members:manage"
        ? user.id === 99 && manageAllowed
        : user.id === 12)
  );
  mocks.query.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.includes("FROM workflow_task t JOIN")) return [[{ ...task }]];
    if (sql.startsWith("SELECT id,status FROM users WHERE id IN"))
      return [
        params[0].map((id: number) => ({
          id,
          status: id === 12 || ownerActive ? "active" : "disabled",
        })),
      ];
    if (sql.startsWith("SELECT id,username,name,email,role,status FROM users"))
      return [[{ id: params[0], role: "user", status: "active" }]];
    if (sql.includes("FROM workflow_task member")) return [[]];
    throw new Error("Unexpected pool query: " + sql);
  });
  mocks.txQuery.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.startsWith("SELECT status FROM workflow_run"))
      return [[{ status: runStatus }]];
    if (sql.startsWith("SELECT id,status FROM workflow_task_group"))
      return [[{ id: "group", status: "waiting" }]];
    if (sql.startsWith("SELECT * FROM workflow_task WHERE"))
      return [[{ ...task }]];
    if (sql.startsWith("SELECT id,status FROM users WHERE id IN"))
      return [
        params[0].map((id: number) => ({
          id,
          status: reactivated ? "active" : "disabled",
        })),
      ];
    if (sql.startsWith("SELECT id,status FROM users WHERE id=?"))
      return [
        [{ id: params[0], status: targetActive ? "active" : "disabled" }],
      ];
    if (sql.includes("SELECT id FROM workflow_task WHERE approvalGroupId"))
      return [duplicate ? [{ id: "other-member" }] : []];
    if (
      sql.startsWith(
        "SELECT id,availableOperationsJson FROM workflow_participant_state"
      )
    )
      return [
        params[1] === 7
          ? [
              {
                id: "old-state",
                availableOperationsJson: JSON.stringify([
                  { taskId: "task" },
                  { taskId: "sibling" },
                ]),
              },
            ]
          : [],
      ];
    if (sql.startsWith("SELECT * FROM workflow_task_schedule")) return [[]];
    if (sql.startsWith("UPDATE workflow_task SET assignedUserId"))
      staged = {
        ...task,
        assignedUserId: params[0],
        candidateUserIdsJson: params[1],
        responsibleUserId: params[2],
        representedUserId: params[3],
        delegationId: params[4],
        status: "pending",
        claimedByUserId: null,
        ownerVersion: task.ownerVersion + 1,
      };
    if (sql.startsWith("UPDATE workflow_task SET payloadJson"))
      staged.payloadJson = params[0];
    return [{ affectedRows: 1 }];
  });
  mocks.commit.mockImplementation(async () => {
    if (staged) task = staged;
  });
  mocks.rollback.mockImplementation(async () => {
    staged = null;
  });
});

it("管理人员可恢复停用处理人的任务，保留表单和同一人的其他待办", async () => {
  expect((await getWorkflowTask(manager, "task"))?.canReassign).toBe(true);
  const updated = await reassignWorkflowTask(manager, input);
  expect(updated).toMatchObject({
    assignedUserId: 12,
    status: "pending",
    ownerVersion: 5,
    canAct: false,
    canReassign: false,
  });
  expect(updated!.payload).toMatchObject({
    context: { input: { reference: "保留" } },
    assignmentRecovery: { reason: input.reason, actorUserId: 99 },
  });
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({ operation: "task_reassigned" }),
    }),
    connection
  );
  const previousState = mocks.txQuery.mock.calls.find(([sql]) =>
    sql.startsWith(
      "UPDATE workflow_participant_state SET availableOperationsJson"
    )
  );
  expect(JSON.parse(previousState![1][0])).toEqual([{ taskId: "sibling" }]);
  expect(
    mocks.txQuery.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO workflow_run_job")
    )
  ).toBe(false);
  expect(mocks.commit).toHaveBeenCalledOnce();
});
it("普通办理人或查看者不能自行启用管理恢复入口", async () => {
  await expect(
    reassignWorkflowTask({ id: 12, role: "user" }, input)
  ).rejects.toThrow("权限");
  expect(mocks.txQuery).not.toHaveBeenCalled();
});
it("仍有启用处理人时拒绝重新分配", async () => {
  ownerActive = true;
  await expect(reassignWorkflowTask(manager, input)).rejects.toThrow("权限");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it.each(["completed", "cancelled"])("已%s的任务不能重新分配", async status => {
  task.status = status;
  await expect(reassignWorkflowTask(manager, input)).rejects.toThrow("权限");
});
it("任务版本过期时拒绝恢复，防止覆盖其他分配", async () => {
  await expect(
    reassignWorkflowTask(manager, { ...input, ownerVersion: 3 })
  ).rejects.toThrow("状态已变化");
  expect(mocks.rollback).toHaveBeenCalledOnce();
});
it("事务期间原账号重新启用时不能抢走仍可办理的任务", async () => {
  reactivated = true;
  await expect(reassignWorkflowTask(manager, input)).rejects.toThrow(
    "仍有启用"
  );
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("事务内目标停用或运行暂停时回滚分配", async () => {
  targetActive = false;
  await expect(reassignWorkflowTask(manager, input)).rejects.toThrow(
    "目标处理人"
  );
  targetActive = true;
  runStatus = "blocked";
  await expect(reassignWorkflowTask(manager, input)).rejects.toThrow(
    "可操作状态"
  );
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("审计失败必须回滚任务与参与人变更", async () => {
  mocks.audit.mockRejectedValueOnce(new Error("audit failed"));
  await expect(reassignWorkflowTask(manager, input)).rejects.toThrow(
    "audit failed"
  );
  expect(task.assignedUserId).toBe(7);
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("会签组内重复处理人不能加入，恢复后成员版本递增", async () => {
  task.approvalGroupId = "group";
  task.groupStatus = "waiting";
  duplicate = true;
  await expect(reassignWorkflowTask(manager, input)).rejects.toThrow(
    "重复移交"
  );
  duplicate = false;
  await reassignWorkflowTask(manager, input);
  expect(
    mocks.txQuery.mock.calls.some(([sql]) =>
      sql.includes("memberVersion=memberVersion+1")
    )
  ).toBe(true);
});
it("已结束审批组不显示恢复入口", async () => {
  task.approvalGroupId = "group";
  task.groupStatus = "completed";
  expect((await getWorkflowTask(manager, "task"))?.canReassign).toBe(false);
  await expect(reassignWorkflowTask(manager, input)).rejects.toThrow("权限");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("当前所有人按领取人、指定人、候选人顺序解析", () => {
  expect(
    currentTaskHandlerIds({ ...task, status: "claimed", claimedByUserId: 8 })
  ).toEqual([8]);
  expect(
    currentTaskHandlerIds({
      ...task,
      status: "pending",
      candidateUserIdsJson: "[8,9]",
    })
  ).toEqual([7]);
  expect(
    currentTaskHandlerIds({
      ...task,
      status: "pending",
      assignedUserId: null,
      candidateUserIdsJson: "[8,9]",
    })
  ).toEqual([8, 9]);
  expect(currentTaskHandlerIds({ ...task, status: "completed" })).toEqual([]);
});
