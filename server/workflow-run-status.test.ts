import { describe, expect, it } from "vitest";
import {
  assertWorkflowRunTransition,
  canTransitionWorkflowRunStatus,
  type WorkflowRunStatus,
} from "./workflow-engine";

describe("workflow run state machine", () => {
  it.each([
    ["queued", "running"],
    ["running", "waiting"],
    ["waiting", "queued"],
    ["running", "success"],
    ["running", "failed"],
    ["running", "blocked"],
    ["blocked", "queued"],
    ["queued", "cancelled"],
    ["running", "terminated"],
  ])("allows %s -> %s", (from, to) => {
    expect(canTransitionWorkflowRunStatus(from as WorkflowRunStatus, to as WorkflowRunStatus)).toBe(true);
    expect(assertWorkflowRunTransition(from as WorkflowRunStatus, to as WorkflowRunStatus)).toBe(to);
  });

  it.each([
    ["success", "running"],
    ["failed", "queued"],
    ["cancelled", "running"],
    ["terminated", "queued"],
    ["waiting", "success"],
    ["blocked", "success"],
  ])("rejects %s -> %s", (from, to) => {
    expect(canTransitionWorkflowRunStatus(from as WorkflowRunStatus, to as WorkflowRunStatus)).toBe(false);
    expect(() => assertWorkflowRunTransition(from as WorkflowRunStatus, to as WorkflowRunStatus)).toThrow("运行状态不允许");
  });
});
