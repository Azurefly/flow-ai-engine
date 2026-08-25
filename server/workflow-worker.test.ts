import { describe, expect, it } from "vitest";
import {
  injectWorkflowWorkerFault,
  outboxRetryDelaySeconds,
  retryDelayMs,
} from "./workflow-worker";

describe("workflow worker retry policy", () => {
  it("uses bounded exponential backoff", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(3)).toBe(4_000);
    expect(retryDelayMs(20)).toBe(60_000);
  });

  it("does not produce sub-second or unbounded retry delays", () => {
    expect(retryDelayMs(0)).toBe(1_000);
    expect(retryDelayMs(-1)).toBe(1_000);
    expect(retryDelayMs(Number.MAX_SAFE_INTEGER)).toBe(60_000);
  });

  it("uses a bounded retry delay for durable outbox events", () => {
    expect(outboxRetryDelaySeconds(1)).toBe(5);
    expect(outboxRetryDelaySeconds(2)).toBe(10);
    expect(outboxRetryDelaySeconds(3)).toBe(20);
    expect(outboxRetryDelaySeconds(99)).toBe(3600);
  });

  it("enables crash injection only in the test runtime", () => {
    const previousPoint = process.env.WORKFLOW_WORKER_FAULT_POINT;
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.WORKFLOW_WORKER_FAULT_POINT =
        "after_execute_before_complete";
      process.env.NODE_ENV = "production";
      expect(() =>
        injectWorkflowWorkerFault("after_execute_before_complete")
      ).not.toThrow();
      process.env.NODE_ENV = "test";
      expect(() =>
        injectWorkflowWorkerFault("after_execute_before_complete")
      ).toThrow("Injected workflow worker crash");
    } finally {
      if (previousPoint === undefined)
        delete process.env.WORKFLOW_WORKER_FAULT_POINT;
      else process.env.WORKFLOW_WORKER_FAULT_POINT = previousPoint;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
