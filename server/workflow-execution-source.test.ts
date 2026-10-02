import { describe, expect, it } from "vitest";
import { resolveWorkflowExecutionSource } from "../shared/workflow-execution-source";

describe("workflow run execution source", () => {
  it("uses a published plan only for a published workflow with a plan and hash", () => {
    expect(
      resolveWorkflowExecutionSource({
        workflowStatus: "published",
        publishedPlan: { version: 1 },
        publishedPlanHash: "a".repeat(64),
      })
    ).toBe("published_plan");
  });

  it("labels published workflows without a usable stored plan as saved definitions", () => {
    expect(
      resolveWorkflowExecutionSource({
        workflowStatus: "published",
        publishedPlan: null,
        publishedPlanHash: null,
      })
    ).toBe("saved_definition");
  });

  it("always compiles the current saved draft even if an old published plan remains", () => {
    expect(
      resolveWorkflowExecutionSource({
        workflowStatus: "draft",
        publishedPlan: { version: 1 },
        publishedPlanHash: "a".repeat(64),
      })
    ).toBe("draft");
  });
});
