import { expect, it } from "vitest";
import { selectOperateApprovers } from "./operate-approver-selection";

it.each(["orSignFor", "andSignFor", "sequentialSignFor"] as const)(
  "%s不静默删除部分无候选资格的指定人员",
  mode => {
    expect(() => selectOperateApprovers([1, 2], [2, 7], mode)).toThrow(
      "审批要求不会自动降低"
    );
  }
);
it("顺序会签保留全部指定人员的顺序", () => {
  expect(
    selectOperateApprovers([1, 2, 3], [3, 1], "sequentialSignFor")
  ).toEqual([3, 1]);
});
it("未指定子集时保留完整候选人，单人模式忽略旧签署设置", () => {
  expect(selectOperateApprovers([1, 2], [], "andSignFor")).toEqual([1, 2]);
  expect(selectOperateApprovers([1], [7], "single")).toEqual([1]);
});
it("或签会签不允许空候选人", () => {
  expect(() => selectOperateApprovers([], [], "orSignFor")).toThrow("未命中");
});
