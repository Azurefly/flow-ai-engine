import { describe, expect, it } from "vitest";
import {
  decodeWorkflowRunHistoryCursor,
  encodeWorkflowRunHistoryCursor,
  WORKFLOW_RUN_HISTORY_MAX_PAGE_SIZE,
  WORKFLOW_RUN_HISTORY_PAGE_SIZE,
} from "./run-history-pagination";

describe("workflow run history pagination", () => {
  it("uses a bounded page size suitable for the monitor list", () => {
    expect(WORKFLOW_RUN_HISTORY_PAGE_SIZE).toBe(25);
    expect(WORKFLOW_RUN_HISTORY_MAX_PAGE_SIZE).toBe(50);
  });

  it("round-trips a stable timestamp and run id through an opaque cursor", () => {
    const createdAt = new Date("2026-09-26T01:14:00.849Z");
    const cursor = encodeWorkflowRunHistoryCursor({
      createdAt,
      id: "c2a9cedc-6540-4e0a-9fe2-848dbb9a3697",
    });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeWorkflowRunHistoryCursor(cursor)).toEqual({
      createdAt,
      id: "c2a9cedc-6540-4e0a-9fe2-848dbb9a3697",
    });
  });

  it.each(["", "not-a-cursor", "a".repeat(513)])(
    "rejects malformed cursor input",
    cursor => {
      expect(() => decodeWorkflowRunHistoryCursor(cursor)).toThrow(
        "运行记录分页位置无效，请刷新后重试。"
      );
    }
  );

  it("rejects payloads with unsupported versions or malformed fields", () => {
    const unsupportedVersion = Buffer.from(
      JSON.stringify({
        version: 2,
        createdAt: "2026-09-26T01:14:00.849Z",
        id: "c2a9cedc-6540-4e0a-9fe2-848dbb9a3697",
      }),
      "utf8"
    ).toString("base64url");

    expect(() => decodeWorkflowRunHistoryCursor(unsupportedVersion)).toThrow(
      "运行记录分页位置无效，请刷新后重试。"
    );
  });
});
