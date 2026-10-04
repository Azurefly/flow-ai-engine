import { expect, it } from "vitest";
import { runStatusSummary, formatRunStatus } from "./run-status-summary";
it("拒绝分支执行成功仍清晰显示业务拒绝与本人办理状态", () => {
  expect(
    runStatusSummary({
      status: "success",
      flowType: "state",
      currentStateName: "业务被拒绝",
      participantStatusName: "已拒绝",
    })
  ).toEqual([
    { label: "执行状态", value: "成功" },
    { label: "业务状态", value: "业务被拒绝" },
    { label: "我的办理状态", value: "已拒绝" },
  ]);
});
it("控制流程不以参与人状态冒充业务状态", () => {
  const result = runStatusSummary({
    status: "waiting",
    flowType: "control",
    currentStateName: "旧状态",
    participantStatusName: "我的待办",
  });
  expect(result[0].value).toBe("等待中");
  expect(result[1].value).toBe("不适用");
  expect(result[2].value).toBe("我的待办");
});
it("未进入业务状态与没有本人办理记录给出明确提示", () => {
  const result = runStatusSummary({ status: "queued", flowType: "state" });
  expect(result[1].value).toBe("尚未进入业务状态");
  expect(result[2].value).toBe("暂无办理记录");
  expect(formatRunStatus("unknown")).toContain("未知状态");
});
