import { expect, it } from "vitest";
import { runMonitorRefreshInterval as interval } from "./run-monitor-refresh";
const idle = { enabled: true, executingRuns: 0, waitingRuns: 0 };
it("执行中及时刷新，等待办理保持普通刷新，全部结束降低频率", () => {
  expect(interval({ ...idle, executingRuns: 1 })).toBe(5_000);
  expect(interval({ ...idle, waitingRuns: 1 })).toBe(15_000);
  expect(interval(idle)).toBe(60_000);
});
it("选中活跃实例不被列表筛选范围中的空闲统计影响", () => {
  expect(interval({ ...idle, selectedStatus: "running" })).toBe(5_000);
  expect(interval({ ...idle, selectedStatus: "waiting" })).toBe(15_000);
});
it("暂停及请求错误停止对应查询，尚未读取统计时仍保持刷新", () => {
  expect(interval({ ...idle, enabled: false })).toBe(false);
  expect(interval({ ...idle, queryFailed: true })).toBe(false);
  expect(interval({ enabled: true })).toBe(15_000);
});
