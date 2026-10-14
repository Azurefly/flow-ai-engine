import { expect, it } from "vitest";
import { workflowLoopDraftError } from "./workflow-loop-policy-draft";
const draft = (value: unknown) => ({
  nodes: [
    { id: "one", name: "是否继续" },
    { id: "two", name: "重新办理" },
  ],
  edges: [
    {
      id: "back",
      sourceNodeId: "one",
      targetNodeId: "two",
      loop: { maxIterations: value },
    },
  ],
});
it("空值和越界编辑保留在草稿中，并明确指出需要修正的连线", () => {
  for (const value of [undefined, "", 0, -1, 1001, 1.5, NaN, true]) {
    const current = draft(value);
    expect(workflowLoopDraftError(current)).toContain("是否继续 → 重新办理");
    expect(current.edges[0].loop.maxIterations).toBe(value);
  }
});
it("正确整数及无循环的草稿可以继续保存，不重写其他配置", () => {
  for (const value of [1, 25, 1000, "3"])
    expect(workflowLoopDraftError(draft(value))).toBeNull();
  expect(workflowLoopDraftError({ edges: [{ id: "forward" }] })).toBeNull();
});
