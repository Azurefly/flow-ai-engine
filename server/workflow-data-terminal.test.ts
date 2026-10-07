import { expect, it } from "vitest";
import {
  analyzeWorkflowDefinition,
  compileWorkflowDefinition,
} from "./workflow-compiler";
const node = (id: string, type: string, config: any = {}) => ({
  id,
  type,
  name: id,
  config,
  position: { x: 0, y: 0 },
});
const fixture = (terminalType: string) => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    node("start", "start"),
    node("source", "source", { assetId: "asset-terminal-test", limit: 100 }),
    node("left", "map", { columns: ["key"], limit: 100 }),
    node("right", "map", { columns: ["amount"], limit: 100 }),
    node("end", "end"),
    node(
      "output",
      terminalType,
      terminalType === "sink"
        ? { writeMode: "audit_only", idempotencyKey: "test-audit-key" }
        : terminalType === "map"
          ? { columns: ["amount"], limit: 100 }
          : {}
    ),
  ],
  edges: [
    ["start", "source"],
    ["source", "left"],
    ["source", "right"],
    ["left", "end"],
    ["right", "output"],
  ].map(([sourceNodeId, targetNodeId]) => ({
    id: `${sourceNodeId}-${targetNodeId}`,
    sourceNodeId,
    targetNodeId,
  })),
});
it.each(["output", "sink"])(
  "数据流程允许 %s 作为另一条分支的最终输出",
  terminalType => {
    expect(() =>
      compileWorkflowDefinition(fixture(terminalType), { flowType: "data" })
    ).not.toThrow();
  }
);
it("普通处理节点断路仍被拒绝", () => {
  const result = analyzeWorkflowDefinition(fixture("map"), {
    flowType: "data",
    executable: true,
  });
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(
      result.diagnostics.some(
        d =>
          d.code === "WF_NODE_CANNOT_REACH_END" &&
          d.location?.kind === "node" &&
          d.location.nodeId === "output"
      )
    ).toBe(true);
});
it("控制流程不把数据输出当作结束节点", () => {
  const result = analyzeWorkflowDefinition(fixture("output"), {
    flowType: "control",
    executable: true,
  });
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(
      result.diagnostics.some(d => d.code === "WF_NODE_CANNOT_REACH_END")
    ).toBe(true);
});
