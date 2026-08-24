import { describe, expect, it } from "vitest";
import { assertWorkflowUpdateTransition } from "./workflow-service";

describe("workflow publication mutation policy", () => {
  it("blocks ordinary definition edits on a published workflow", () => {
    expect(() =>
      assertWorkflowUpdateTransition("published", { definition: { nodes: [] } })
    ).toThrow("已发布流程不能直接修改定义");
  });

  it("allows explicit publish/unpublish transitions and draft edits", () => {
    expect(() =>
      assertWorkflowUpdateTransition("published", {
        definition: { nodes: [] },
        publish: true,
      })
    ).not.toThrow();
    expect(() =>
      assertWorkflowUpdateTransition("published", {
        definition: { nodes: [] },
        unpublish: true,
      })
    ).not.toThrow();
    expect(() =>
      assertWorkflowUpdateTransition("draft", { definition: { nodes: [] } })
    ).not.toThrow();
  });
});
