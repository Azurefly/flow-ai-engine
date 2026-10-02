import { describe, expect, it } from "vitest";
import { normalizeWorkflowRunSearchQuery } from "../shared/workflow-run-search";

describe("workflow run history search", () => {
  it.each([
    ["排队中", "queued"],
    ["运行中", "running"],
    ["等待人工", "waiting"],
    ["已暂停", "blocked"],
    ["成功", "success"],
    ["失败", "failed"],
    ["已取消", "cancelled"],
    ["已终止", "terminated"],
  ])(
    "maps the visible status label %s to its stored value",
    (label, status) => {
      expect(normalizeWorkflowRunSearchQuery(label)).toBe(status);
    }
  );

  it("trims but preserves non-status search text", () => {
    expect(normalizeWorkflowRunSearchQuery("  Remote User  ")).toBe(
      "Remote User"
    );
  });
});
