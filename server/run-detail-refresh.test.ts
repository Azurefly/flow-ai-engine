import { describe, expect, it } from "vitest";
import { runDetailRefreshInterval } from "../shared/run-detail-refresh";

describe("instance detail refresh", () => {
  it("follows queued and executing instances quickly and waits less frequently for human action", () => {
    for (const status of ["queued", "running"])
      expect(runDetailRefreshInterval(status)).toBe(2000);
    for (const status of ["waiting", "blocked"])
      expect(runDetailRefreshInterval(status)).toBe(15000);
  });
  it("stops after completion, unknown states, or access/network errors", () => {
    for (const status of [
      "success",
      "failed",
      "cancelled",
      "terminated",
      undefined,
      null,
      "unknown",
    ]) {
      expect(runDetailRefreshInterval(status)).toBe(false);
    }
    for (const status of ["queued", "running", "waiting", "blocked"])
      expect(runDetailRefreshInterval(status, true)).toBe(false);
  });
});
