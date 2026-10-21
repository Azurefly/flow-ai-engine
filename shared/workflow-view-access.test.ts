import { expect, it } from "vitest";
import { workflowViewState } from "./workflow-view-access";
const baseline = {
  workflowId: "current",
  accessWorkflowId: "current",
  status: "success" as const,
  exists: true,
  permissions: new Set(["workflow:view", "workflow:edit"]),
};
it("明确确认当前流程的查看权限后才能显示缓存内容", () => {
  expect(workflowViewState(baseline)).toBe("granted");
  for (const permissions of [
    undefined,
    null,
    new Set<string>(),
    new Set(["workflow:edit", "workflow:publish"]),
  ])
    expect(workflowViewState({ ...baseline, permissions })).toBe("denied");
  expect(workflowViewState({ ...baseline, exists: false })).toBe("denied");
});
it("切换、初始等待及读取失败不能复用旧授权", () => {
  expect(workflowViewState({ ...baseline, workflowId: "next" })).toBe(
    "checking"
  );
  expect(workflowViewState({ ...baseline, workflowId: null })).toBe("checking");
  expect(workflowViewState({ ...baseline, status: "pending" })).toBe(
    "checking"
  );
  expect(workflowViewState({ ...baseline, status: "error" })).toBe(
    "unavailable"
  );
});
it("失权后恢复同一流程的查看权限不需要更换草稿身份", () => {
  expect(workflowViewState({ ...baseline, permissions: new Set() })).toBe(
    "denied"
  );
  expect(
    workflowViewState({ ...baseline, permissions: new Set(["workflow:view"]) })
  ).toBe("granted");
});
