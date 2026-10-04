import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { getRunApprovalProgress } from "./run-approval-progress";
import { RunApprovalProgress } from "../client/src/components/RunApprovalProgress";
import { approvalParticipantStatus } from "../shared/run-approval-progress";
it("只统计已完成的通过或拒绝，保留取消及等待人员", async () => {
  const row = {
    nodeId: "approve",
    signMode: "andSignFor",
    totalApprovers: "3",
    requiredApprovals: "2",
  };
  mocks.query.mockResolvedValue([
    [
      {
        ...row,
        status: "completed",
        decision: "approved",
        participantName: "甲",
      },
      {
        ...row,
        status: "completed",
        decision: "rejected",
        participantName: "乙",
      },
      {
        ...row,
        status: "cancelled",
        decision: "approved",
        participantName: "丙",
      },
    ],
  ]);
  const [group] = await getRunApprovalProgress("run-1");
  expect(group).toMatchObject({
    total: 3,
    required: 2,
    approved: 1,
    rejected: 1,
  });
  expect(group.participants).toHaveLength(3);
  expect(mocks.query.mock.calls[0][1]).toEqual(["run-1"]);
  const html = renderToStaticMarkup(
    createElement(RunApprovalProgress, { group })
  );
  expect(html).toContain('aria-label="审批进度"');
  expect(html).toContain("需通过 2 人");
  expect(html).toContain("已取消");
});
it("未知或无明确决定的已完成任务不被误标为通过", () => {
  expect(approvalParticipantStatus("completed", null)).toBe("已办理");
  expect(approvalParticipantStatus("pending", null)).toBe("待办理");
  expect(approvalParticipantStatus("claimed", null)).toBe("办理中");
});
it("顺序会签明确显示人员顺序", () => {
  const html = renderToStaticMarkup(
    createElement(RunApprovalProgress, {
      group: {
        nodeId: "approve",
        signMode: "sequentialSignFor",
        total: 2,
        required: 2,
        approved: 1,
        rejected: 0,
        participants: [
          { name: "甲", status: "completed", decision: "approved" },
          { name: "乙", status: "pending", decision: null },
        ],
      },
    })
  );
  expect(html).toContain("1. ");
  expect(html).toContain("2. ");
  expect(html).toContain("待办理");
});
