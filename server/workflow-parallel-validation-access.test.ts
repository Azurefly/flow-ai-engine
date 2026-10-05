import { expect, it } from "vitest";
import { canValidateParallelRuntime } from "./workflow-engine";
it("仅管理员的草稿测试可进入并行验证，发布版本和普通运行不放行", () => {
  expect(canValidateParallelRuntime("test", "admin", "draft")).toBe(true);
  for (const [trigger, role, source] of [
    ["manual", "admin", "draft"],
    ["test", "user", "draft"],
    ["test", "admin", "published_plan"],
    ["test", "admin", "saved_definition"],
  ])
    expect(canValidateParallelRuntime(trigger, role, source)).toBe(false);
});
