import { expect, it } from "vitest";
import { workflowDiagnosticTarget } from "./workflow-diagnostic-target";

const graph = {
  nodes: [{ id: "review", name: "市局签收" }, { id: "end" }],
  edges: [{ id: "review-end" }],
};
it("处理人错误定位实际节点，并显示业务名称", () => {
  expect(
    workflowDiagnosticTarget({ kind: "node", nodeId: "review" }, graph)
  ).toEqual({ nodeId: "review", label: "定位节点：市局签收" });
  expect(workflowDiagnosticTarget({ nodeId: "end" }, graph)?.label).toBe(
    "定位节点：end"
  );
});
it("连线诊断优先定位连线，不错误进入其端点", () => {
  expect(
    workflowDiagnosticTarget(
      { kind: "edge", nodeId: "review", edgeId: "review-end" },
      graph
    )
  ).toEqual({ edgeId: "review-end", label: "定位连线：review-end" });
});
it("当前草稿中被删除的目标和流程整体问题不猜测其他节点", () => {
  expect(workflowDiagnosticTarget({ nodeId: "deleted" }, graph)).toBeNull();
  expect(workflowDiagnosticTarget({ edgeId: "deleted" }, graph)).toBeNull();
  expect(workflowDiagnosticTarget({ kind: "definition" }, graph)).toBeNull();
  expect(
    workflowDiagnosticTarget({ nodeId: "review" }, { nodes: [], edges: [] })
  ).toBeNull();
});
