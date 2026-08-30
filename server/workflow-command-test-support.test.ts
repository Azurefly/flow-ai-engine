import { describe, expect, it } from "vitest";
import { waitingTaskIdForRun } from "./workflow-command-test-support";

describe("waitingTaskIdForRun", () => {
  it("recognizes a task while the durable run is either running or waiting", () => {
    const task = { id: "task-1" };

    expect(waitingTaskIdForRun({ status: "running" }, task)).toBe("task-1");
    expect(waitingTaskIdForRun({ status: "waiting" }, task)).toBe("task-1");
  });

  it("does not infer a waiting command without a pending task", () => {
    expect(
      waitingTaskIdForRun({ status: "waiting" }, undefined)
    ).toBeUndefined();
    expect(
      waitingTaskIdForRun({ status: "success" }, { id: "task-1" })
    ).toBeUndefined();
    expect(
      waitingTaskIdForRun({ status: "waiting" }, { id: null })
    ).toBeUndefined();
  });
});
