import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { getRunApprovalProgress } from "./run-approval-progress";
import { RunApprovalProgress } from "../client/src/components/RunApprovalProgress";
import {
  approvalParticipantStatus,
  approvalGroupsForRecord,
} from "../shared/run-approval-progress";
it("只统计已完成的通过或拒绝，保留取消及等待人员", async () => {
  const row = {
    groupId: "group-1",
    nodeRunId: "record-1",
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
        groupId: "group-1",
        nodeRunId: "record-1",
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

it("同一共享节点的不同审批组分别计数，并保留各批次意见", async () => {
  const common = {
    nodeId: "shared",
    signMode: "sequentialSignFor",
    totalApprovers: 2,
    requiredApprovals: 2,
    status: "completed",
    decision: "approved",
  };
  mocks.query.mockResolvedValue([
    [
      {
        ...common,
        groupId: "a",
        nodeRunId: "record-a",
        participantName: "甲",
        comment: "A意见甲",
      },
      {
        ...common,
        groupId: "a",
        nodeRunId: "record-a",
        participantName: "乙",
        comment: "A意见乙",
      },
      {
        ...common,
        groupId: "b",
        nodeRunId: "record-b",
        participantName: "甲",
        comment: "B意见甲",
      },
      {
        ...common,
        groupId: "b",
        nodeRunId: "record-b",
        participantName: "乙",
        decision: "abstained",
        comment: "B弃权",
      },
    ],
  ]);
  const groups = await getRunApprovalProgress("shared-run");
  expect(
    groups.map(group => [
      group.groupId,
      group.nodeRunId,
      group.approved,
      group.required,
      group.participants.length,
    ])
  ).toEqual([
    ["a", "record-a", 2, 2, 2],
    ["b", "record-b", 1, 2, 2],
  ]);
  expect(
    approvalGroupsForRecord(groups, { id: "record-a", nodeId: "shared" })
  ).toEqual([groups[0]]);
  const html = renderToStaticMarkup(
    createElement(RunApprovalProgress, { group: groups[1] })
  );
  expect(html).toContain("顺序会签进度");
  expect(html).toContain("B弃权");
  expect(html).toContain("已弃权");
  expect(html).not.toContain("A意见");
});
it("旧记录只通过明确组标识关联，不按节点名或列表顺序猜测", () => {
  const group = {
    groupId: "a",
    nodeRunId: null,
    nodeId: "shared",
    signMode: "andSignFor",
    total: 2,
    required: 2,
    approved: 2,
    rejected: 0,
    participants: [],
  };
  expect(approvalGroupsForRecord([group], { outputJson: { approvalGroupId: "a" } })).toEqual([]);
  expect(
    approvalGroupsForRecord([group], {
      id: "old",
      nodeId: "shared",
      outputJson: '{"approvalGroupId":"a"}',
    })
  ).toEqual([group]);
  expect(
    approvalGroupsForRecord([group], {
      id: "old",
      nodeId: "shared",
      outputJson: "invalid-json",
    })
  ).toEqual([]);
  expect(
    approvalGroupsForRecord([group], {
      id: "old",
      nodeId: "different",
      outputJson: { approvalGroupId: "a" },
    })
  ).toEqual([]);
  expect(
    approvalGroupsForRecord([{ ...group, nodeRunId: "other" }], {
      id: "old",
      nodeId: "shared",
      outputJson: { approvalGroupId: "a" },
    })
  ).toEqual([]);
  expect(
    approvalGroupsForRecord([{ ...group, nodeRunId: "old" }], {
      id: "old",
      nodeId: "shared",
      outputJson: { approvalGroupId: "b" },
    })
  ).toEqual([]);
});
it("同一审批组出现冲突的批次标识时不选取任意一个", async () => {
  const common = {
    groupId: "bad",
    nodeId: "shared",
    signMode: "andSignFor",
    totalApprovers: 2,
    requiredApprovals: 2,
    status: "pending",
    decision: null,
    participantName: "甲",
  };
  mocks.query.mockResolvedValue([
    [
      { ...common, nodeRunId: "one" },
      { ...common, nodeRunId: "two" },
    ],
  ]);
  const [group] = await getRunApprovalProgress("old-run");
  expect(group.nodeRunId).toBeNull();
  expect(group.batchConflict).toBe(true);
  expect(group.approved).toBe(0);
  expect(
    approvalGroupsForRecord([group], { id: "one", nodeId: "shared" })
  ).toEqual([]);
  expect(
    approvalGroupsForRecord([group], {
      id: "one",
      nodeId: "shared",
      outputJson: { approvalGroupId: "bad" },
    })
  ).toEqual([]);
});
