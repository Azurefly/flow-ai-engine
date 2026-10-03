import { expect, it } from "vitest";
import { canManageTask } from "../shared/task-assignment";
it("only permits assignment controls for actionable active tasks", () => {
  expect(canManageTask({ status: "pending", canAct: true })).toBe(true);
  expect(canManageTask({ status: "claimed", canAct: true })).toBe(true);
  for (const status of ["completed", "cancelled", "failed", undefined])
    expect(canManageTask({ status, canAct: true })).toBe(false);
  expect(canManageTask({ status: "pending", canAct: false })).toBe(false);
  expect(canManageTask({ status: "pending", canAct: "true" })).toBe(false);
  expect(canManageTask(undefined)).toBe(false);
});
