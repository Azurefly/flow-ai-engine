import { expect, it } from "vitest";
import { shouldResetRunRoute } from "./run-route-guard";
const target = {
  requestedRunId: "new-run",
  queriedRunId: "new-run",
  workflowId: "new-flow",
  queryFailed: false,
};
it("切换路由时旧查询数据不能清除新实例链接", () => {
  expect(
    shouldResetRunRoute({
      ...target,
      queriedRunId: "old-run",
      detail: { id: "old-run", workflowId: "old-flow" },
    })
  ).toBe(false);
});
it("旧查询错误不能清除新实例链接", () => {
  expect(
    shouldResetRunRoute({
      ...target,
      queriedRunId: "old-run",
      queryFailed: true,
    })
  ).toBe(false);
});
it("尚未加载当前实例时保持直达链接", () => {
  expect(shouldResetRunRoute(target)).toBe(false);
  expect(
    shouldResetRunRoute({
      ...target,
      detail: { id: "old-run", workflowId: "old-flow" },
    })
  ).toBe(false);
});
it("当前实例匹配流程时保持路由，不匹配或查询失败时安全返回列表", () => {
  expect(
    shouldResetRunRoute({
      ...target,
      detail: { id: "new-run", workflowId: "new-flow" },
    })
  ).toBe(false);
  expect(
    shouldResetRunRoute({
      ...target,
      detail: { id: "new-run", workflowId: "wrong-flow" },
    })
  ).toBe(true);
  expect(shouldResetRunRoute({ ...target, queryFailed: true })).toBe(true);
});
