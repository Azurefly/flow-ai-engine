import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./organization-service", () => ({
  resolveOperateAssignees: mocks.resolve,
}));
import { previewOperateApproval } from "./workflow-approval-preview";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue({
    candidateUserIds: [2, 7, 9],
    assignedUserId: null,
    mode: "department",
  });
  mocks.query.mockResolvedValue([
    [
      { id: 2, name: "甲", username: "a", email: "private" },
      { id: 9, name: "乙", username: "b" },
    ],
  ]);
});
const input = { workflowId: "test-flow", context: {}, config: {} };
it("预览按照明确审批顺序展示姓名，且不暴露额外人员字段", async () => {
  const result = await previewOperateApproval({
    ...input,
    config: { bdcz: { hqhqsz: "sequentialSignFor", xzdfhq: [9, 2] } },
  });
  expect(result.candidateUserIds).toEqual([9, 2]);
  expect(result.users).toEqual([
    { id: 9, name: "乙", username: "b" },
    { id: 2, name: "甲", username: "a" },
  ]);
  expect(result).toMatchObject({
    requiredApprovals: 2,
    totalApprovers: 2,
    signModeLabel: "顺序会签",
  });
  expect(mocks.query.mock.calls[0][1]).toEqual([9, 2]);
});
it("会签比例预览与实际向上取整规则一致", async () => {
  const result = await previewOperateApproval({
    ...input,
    config: { bdcz: { hqhqsz: "andSignFor", hqtgbfb: 66 } },
  });
  expect(result.requiredApprovals).toBe(2);
  const boundary = await previewOperateApproval({
    ...input,
    config: { bdcz: { hqhqsz: "andSignFor", hqtgbfb: 1 } },
  });
  expect(boundary.requiredApprovals).toBe(1);
});
it("指定审批人没有候选资格时不展示错误成功结果", async () => {
  await expect(
    previewOperateApproval({
      ...input,
      config: { bdcz: { hqhqsz: "orSignFor", xzdfhq: [99] } },
    })
  ).rejects.toThrow("未命中");
  expect(mocks.query).not.toHaveBeenCalled();
});
it("大量候选人限制姓名查询体积，人数和通过要求仍按完整名单计算", async () => {
  mocks.resolve.mockResolvedValue({
    candidateUserIds: Array.from({ length: 120 }, (_, index) => index + 1),
  });
  const result = await previewOperateApproval({
    ...input,
    config: { bdcz: { hqhqsz: "andSignFor", hqtgbfb: 100 } },
  });
  expect(result).toMatchObject({
    requiredApprovals: 120,
    totalApprovers: 120,
    hasMore: true,
  });
  expect(result.users).toHaveLength(100);
  expect(mocks.query.mock.calls[0][1]).toHaveLength(100);
});
