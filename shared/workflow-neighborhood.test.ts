import { expect, it } from "vitest";
import { traceWorkflowNeighborhood } from "./workflow-neighborhood";
const edge = (source: string, target: string) => ({
  id: `${source}-${target}`,
  source,
  target,
});
it("只追踪上游和下游，保留方向且不夹带平行支路", () => {
  const result = traceWorkflowNeighborhood(
    ["a", "b", "c", "d", "x"],
    [edge("a", "b"), edge("b", "c"), edge("a", "d"), edge("x", "d")],
    "b"
  )!;
  expect(Array.from(result.upstream)).toEqual(["a"]);
  expect(Array.from(result.downstream)).toEqual(["c"]);
  expect(Array.from(result.nodes).sort()).toEqual(["a", "b", "c"]);
  expect(Array.from(result.edges).sort()).toEqual(["a-b", "b-c"]);
});
it("状态循环、自环、重复连线和无效端点都不会无限遍历", () => {
  const edges = [
    edge("a", "b"),
    edge("b", "a"),
    edge("a", "a"),
    edge("b", "missing"),
  ];
  const before = JSON.stringify(edges);
  const result = traceWorkflowNeighborhood(["a", "b"], edges, "a")!;
  expect(Array.from(result.upstream)).toEqual(["b"]);
  expect(Array.from(result.downstream)).toEqual(["b"]);
  expect(result.edges.size).toBe(3);
  expect(JSON.stringify(edges)).toBe(before);
});
it("单节点仍可选择，没有选中节点时不改变画布", () => {
  expect(traceWorkflowNeighborhood(["a"], [], "a")?.nodes.size).toBe(1);
  expect(traceWorkflowNeighborhood(["a"], [], null)).toBeNull();
  expect(traceWorkflowNeighborhood(["a"], [], "missing")).toBeNull();
});
