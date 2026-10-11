import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: vi.fn() }));
import { resolveOperateAssignees } from "./organization-service";

let active: Set<number>;
const input = {
  workflowId: "test-workflow",
  context: { input: { approvers: [7, 8] }, runtime: { triggeredByUserId: 1 } },
};
beforeEach(() => {
  vi.resetAllMocks();
  active = new Set([1, 2, 3]);
  mocks.query.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.startsWith("SELECT ownerUserId")) return [[{ ownerUserId: 2 }]];
    if (sql.startsWith("SELECT id FROM users WHERE id IN"))
      return [
        params[0]
          .filter((id: number) => active.has(id))
          .map((id: number) => ({ id })),
      ];
    if (sql.startsWith("SELECT id FROM users WHERE id=?"))
      return [active.has(params[0]) ? [{ id: params[0] }] : []];
    throw new Error(`Unexpected query: ${sql}`);
  });
});
it.each(["initiator", "owner"])(
  "指定人员停用时按显式 %s 策略兜底",
  async fallback => {
    const result = await resolveOperateAssignees({
      ...input,
      config: {
        assigneeMode: "user",
        assigneeUserId: 7,
        assigneeFallback: fallback,
      },
    });
    expect(result).toMatchObject({
      assignedUserId: fallback === "owner" ? 2 : 1,
      fallbackApplied: fallback,
      excluded: [{ userId: 7, reason: "不存在或已停用" }],
    });
  }
);
it("默认报错策略不会替换停用的处理人", async () => {
  await expect(
    resolveOperateAssignees({
      ...input,
      config: { assigneeMode: "user", assigneeUserId: 7 },
    })
  ).rejects.toThrow("未配置可用兜底");
});
it("表单候选人全部不可用时可以兜底", async () => {
  const result = await resolveOperateAssignees({
    ...input,
    config: {
      assigneeMode: "form_user",
      assigneeFormField: "input.approvers",
      assigneeFallback: "owner",
    },
  });
  expect(result.candidateUserIds).toEqual([2]);
  expect(result.excluded.map(item => item.userId)).toEqual([7, 8]);
});
it("部分候选人停用时不会静默降低审批人数", async () => {
  await expect(
    resolveOperateAssignees({
      ...input,
      context: { ...input.context, input: { approvers: [3, 7] } },
      config: {
        assigneeMode: "form_user",
        assigneeFormField: "input.approvers",
        assigneeFallback: "owner",
      },
    })
  ).rejects.toThrow("审批要求不会自动降低");
});
it("兜底对象也停用时仍拒绝，不能分配给无法登录的人", async () => {
  active.delete(2);
  await expect(
    resolveOperateAssignees({
      ...input,
      config: {
        assigneeMode: "user",
        assigneeUserId: 7,
        assigneeFallback: "owner",
      },
    })
  ).rejects.toThrow("兜底处理人不存在或已停用");
});
it("启用人员保留表单顺序和去重，只批量检查一次", async () => {
  const result = await resolveOperateAssignees({
    ...input,
    context: { ...input.context, input: { approvers: [3, 1, 3] } },
    config: { assigneeMode: "form_user", assigneeFormField: "input.approvers" },
  });
  expect(result.candidateUserIds).toEqual([3, 1]);
  expect(result.fallbackApplied).toBeUndefined();
  expect(result.excluded).toEqual([]);
  expect(mocks.query).toHaveBeenCalledOnce();
});
