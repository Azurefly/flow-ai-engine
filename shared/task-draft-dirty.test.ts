import { expect, it } from "vitest";
import { hasTaskDraftChanges } from "./task-draft-dirty";
const initial = {
  rows: [{ key: "amount", value: "0" }],
  initialRows: [{ key: "amount", value: "0" }],
  outcome: "approved",
  initialOutcome: "approved",
  comment: "",
  targetUserId: "",
  reassignmentReason: "",
  removeMemberTaskId: "",
};
it("进入任务和追加空白扩展行不产生未提交修改", () => {
  expect(hasTaskDraftChanges(initial)).toBe(false);
  expect(
    hasTaskDraftChanges({
      ...initial,
      rows: [...initial.rows, { key: "", value: "" }],
    })
  ).toBe(false);
});
it("字段清空、审批决定、意见和转交配置改变都需保留", () => {
  expect(
    hasTaskDraftChanges({ ...initial, rows: [{ key: "amount", value: "" }] })
  ).toBe(true);
  for (const [key, value] of Object.entries({
    outcome: "rejected",
    comment: " ",
    targetUserId: "3",
    reassignmentReason: "转交说明",
    removeMemberTaskId: "task-2",
  }))
    expect(hasTaskDraftChanges({ ...initial, [key]: value })).toBe(true);
});
