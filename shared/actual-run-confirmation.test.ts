import { describe, expect, it } from "vitest";
import { canStartActualWorkflowRun } from "./actual-run-confirmation";

describe("canStartActualWorkflowRun", () => {
  it("allows execution only with run permission, an idle runner, and explicit acknowledgment", () => {
    expect(
      canStartActualWorkflowRun({
        canRun: true,
        isRunning: false,
        acknowledged: true,
      })
    ).toBe(true);

    expect(
      canStartActualWorkflowRun({
        canRun: true,
        isRunning: false,
        acknowledged: false,
      })
    ).toBe(false);

    expect(
      canStartActualWorkflowRun({
        canRun: false,
        isRunning: false,
        acknowledged: true,
      })
    ).toBe(false);

    expect(
      canStartActualWorkflowRun({
        canRun: true,
        isRunning: true,
        acknowledged: true,
      })
    ).toBe(false);
  });
});
