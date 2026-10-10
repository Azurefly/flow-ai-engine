import { expect, it } from "vitest";
import { shouldConfirmWorkflowNavigation } from "./workflow-navigation";

it("无未保存草稿允许离开", () => {
  expect(shouldConfirmWorkflowNavigation(null, { section: "warehouse" })).toBe(false);
});
it("同一流程编辑路由无需确认", () => {
  expect(shouldConfirmWorkflowNavigation("own", { section: "flows", view: "editor", workflowId: "own" })).toBe(false);
});
it("切换流程或退出编辑器需要确认", () => {
  for (const target of [
    { section: "flows", view: "editor", workflowId: "other" },
    { section: "flows", view: "detail", workflowId: "own" },
    { section: "flows", view: "center" },
    { section: "runs", view: "workbench" },
    { section: "system", view: "config" },
    { section: "warehouse" },
  ] as const) expect(shouldConfirmWorkflowNavigation("own", target)).toBe(true);
});
