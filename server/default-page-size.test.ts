import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = (file: string) =>
  readFileSync(
    new URL(`../client/src/components/${file}.tsx`, import.meta.url),
    "utf8"
  );

describe("small default list pages", () => {
  it("starts the workbench at ten while preserving larger page choices", () => {
    const workbench = source("ProcessWorkbench");
    expect(workbench).toContain("const [pageSize, setPageSize] = useState(10)");
    for (const size of [10, 20, 50, 100])
      expect(workbench).toContain(
        `<option value={${size}}>${size} 条</option>`
      );
  });
  it("uses ten for run records, organization members, and test output", () => {
    for (const file of [
      "RunCenter",
      "WorkflowGovernance",
      "OrganizationManagementPage",
    ])
      expect(source(file)).toContain("pageSize: 10");
    expect(source("WorkflowGovernance")).toContain("每页最多 10 条");
    expect(source("WorkflowTestRunModal")).toContain("OUTPUT_PAGE_SIZE = 10");
  });
});
