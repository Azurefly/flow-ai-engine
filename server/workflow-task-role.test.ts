import { expect, it } from "vitest";
import { workflowTaskRoleKey } from "./workflow-task-role";
it("普通任务保留角色，并行任务按分支和节点隔离操作记录", () => {
  const a = [{ frameId: "f", branchId: "a" }];
  const b = [{ frameId: "f", branchId: "b" }];
  expect(workflowTaskRoleKey("default", "node", [])).toBe("default");
  const key = workflowTaskRoleKey("default", "node", a);
  expect(workflowTaskRoleKey("default", "node", a)).toBe(key);
  expect(workflowTaskRoleKey("default", "node", b)).not.toBe(key);
  expect(workflowTaskRoleKey("default", "other", a)).not.toBe(key);
  expect(workflowTaskRoleKey("manager", "node", a)).not.toBe(key);
  expect(key.length).toBeLessThanOrEqual(64);
});
