import { describe, expect, it } from "vitest";
import { outboxRetryDelaySeconds, retryDelayMs } from "./workflow-worker";

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
});
