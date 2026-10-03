import { describe, expect, it } from "vitest";
import { canConnectCanvasNodes } from "../client/src/components/workflow-canvas-connections";
import type { FlowNodeType } from "../shared/workflow-node-contract";
const node = (id: string, kind: FlowNodeType) => ({
  id,
  data: { kind, config: {} },
});

describe("画布多分支连线", () => {
  it("数据开始节点可连接多路资源，控制流程保留单出口限制", () => {
    const edges = [{ source: "start", target: "left" }];
    expect(
      canConnectCanvasNodes(
        node("start", "start"),
        node("right", "source"),
        edges,
        "data"
      )
    ).toBe(true);
    expect(
      canConnectCanvasNodes(
        node("start", "start"),
        node("right", "http"),
        edges,
        "control"
      )
    ).toBe(false);
  });
  it("允许结束节点接收不同分支，也允许条件另一分支直接结束", () => {
    const edges = [
      { source: "condition", sourceHandle: "true", target: "work" },
      { source: "other", target: "end" },
    ];
    expect(
      canConnectCanvasNodes(
        node("condition", "condition"),
        node("end", "end"),
        edges,
        "control"
      )
    ).toBe(true);
  });
  it("继续阻止重复连线、自环和倒接开始结束节点", () => {
    const start = node("start", "start");
    const source = node("source", "source");
    expect(
      canConnectCanvasNodes(
        start,
        source,
        [{ source: "start", target: "source" }],
        "data"
      )
    ).toBe(false);
    expect(canConnectCanvasNodes(source, source, [], "data")).toBe(false);
    expect(canConnectCanvasNodes(source, start, [], "data")).toBe(false);
    expect(canConnectCanvasNodes(node("end", "end"), source, [], "data")).toBe(
      false
    );
  });
});
