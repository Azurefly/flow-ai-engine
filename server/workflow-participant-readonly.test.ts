import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), permission: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./iam-service", () => ({ hasWorkflowPermission: mocks.permission }));
import { searchWorkflowParticipants } from "./workflow-participant-directory";
const user = { id: 7, role: "user" as const };
const input = {
  workflowId: "workflow-1",
  kind: "user" as const,
  query: "",
  selectedIds: ["17"],
  readOnly: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.query.mockResolvedValueOnce([
    [
      {
        definitionJson: JSON.stringify({
          nodes: [
            {
              type: "operate",
              config: {
                assigneeUserId: 17,
                assigneeUnitIds: ["unit-1"],
                assigneeRoleCode: "approver",
                bdcz: { xzdfhq: [18] },
              },
            },
          ],
        }),
      },
    ],
  ]);
});
it("查看者只解析流程已配置的人员姓名，不搜索全局目录", async () => {
  mocks.query.mockResolvedValueOnce([
    [{ id: 17, name: "审批人", username: "approver" }],
  ]);
  expect(await searchWorkflowParticipants(user, input)).toEqual({
    items: [],
    selected: [{ value: "17", label: "审批人（approver）" }],
    hasMore: false,
  });
  expect(mocks.permission).toHaveBeenCalledWith(
    user,
    input.workflowId,
    "workflow:view"
  );
  expect(mocks.query).toHaveBeenCalledTimes(2);
});
it("任意未配置人员与全局搜索均被拒绝", async () => {
  await expect(
    searchWorkflowParticipants(user, { ...input, selectedIds: ["99"] })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  await expect(
    searchWorkflowParticipants(user, { ...input, query: "审批" })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
it("没有流程查看权限时不读取定义或人员", async () => {
  mocks.permission.mockResolvedValue(false);
  await expect(searchWorkflowParticipants(user, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(mocks.query).not.toHaveBeenCalled();
});
it.each([
  ["department", "unit-1"],
  ["role", "approver"],
  ["user", "18"],
] as const)("可解析已配置的 %s", async (kind, id) => {
  mocks.query.mockResolvedValueOnce([[]]);
  await expect(
    searchWorkflowParticipants(user, { ...input, kind, selectedIds: [id] })
  ).resolves.toMatchObject({ items: [], hasMore: false });
});
