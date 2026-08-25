import { describe, expect, it } from "vitest";
import { emptyDefinition, validate } from "./workflow-service";
import { analyzeWorkflowDefinition } from "./workflow-compiler";

const validateState = (definition: unknown, executable = false) =>
  validate(definition, { flowType: "state", executable });

describe("流程定义输入边界", () => {
  it("拒绝缺少节点、未知节点类型、非法位置、数组配置和悬挂连线", () => {
    expect(() => validateState({})).toThrow("流程定义格式无效");
    const unknownType = emptyDefinition();
    (unknownType.nodes[0] as any).type = "shell";
    expect(() => validateState(unknownType)).toThrow("节点格式或类型无效");
    const invalidPosition = emptyDefinition();
    (invalidPosition.nodes[0] as any).position = { x: "bad", y: 0 };
    expect(() => validateState(invalidPosition)).toThrow("节点位置无效");
    const invalidConfig = emptyDefinition();
    (invalidConfig.nodes[0] as any).config = [];
    expect(() => validateState(invalidConfig)).toThrow(
      "节点配置必须是 JSON 对象"
    );
    const danglingEdge = emptyDefinition();
    danglingEdge.edges[0]!.targetNodeId = "missing";
    expect(() => validateState(danglingEdge)).toThrow("连线引用了不存在的节点");
  });

  it("拒绝重复连线、自环和非法的起止节点方向", () => {
    const duplicateEdgeId = emptyDefinition();
    duplicateEdgeId.nodes.splice(1, 0, {
      id: "middle",
      type: "state",
      name: "处理中",
      position: { x: 260, y: 180 },
      config: { nodeDh: "MIDDLE", jdmc: "处理中", flowStatus: "处理中" },
    });
    duplicateEdgeId.edges = [
      { id: "same", sourceNodeId: "start", targetNodeId: "middle" },
      { id: "same", sourceNodeId: "middle", targetNodeId: "end" },
    ];
    expect(() => validateState(duplicateEdgeId, true)).toThrow(
      "连线 ID 不可重复"
    );

    const selfLoop = emptyDefinition();
    selfLoop.edges.push({
      id: "self",
      sourceNodeId: "start",
      targetNodeId: "start",
    });
    expect(() => validateState(selfLoop, true)).toThrow("不允许节点自环");

    const startIncoming = emptyDefinition();
    startIncoming.edges.push({
      id: "end-start",
      sourceNodeId: "end",
      targetNodeId: "start",
    });
    expect(() => validateState(startIncoming, true)).toThrow(
      "开始节点不允许存在入边"
    );

    const endOutgoing = emptyDefinition();
    endOutgoing.nodes.push({
      id: "after-end",
      type: "state",
      name: "结束后节点",
      position: { x: 620, y: 180 },
      config: {
        nodeDh: "AFTER_END",
        jdmc: "结束后节点",
        flowStatus: "结束后节点",
      },
    });
    endOutgoing.edges.push({
      id: "end-after",
      sourceNodeId: "end",
      targetNodeId: "after-end",
    });
    expect(() => validateState(endOutgoing, true)).toThrow(
      "结束节点不允许存在出边"
    );
  });

  it("发布时拒绝不可达节点、无法到达终点的死路和循环", () => {
    const unreachable = emptyDefinition();
    unreachable.nodes.push({
      id: "orphan",
      type: "state",
      name: "孤立节点",
      position: { x: 260, y: 320 },
      config: { nodeDh: "ORPHAN", jdmc: "孤立节点", flowStatus: "孤立节点" },
    });
    const unreachableResult = analyzeWorkflowDefinition(unreachable, {
      flowType: "state",
      executable: true,
    });
    expect(unreachableResult.ok).toBe(false);
    if (!unreachableResult.ok)
      expect(unreachableResult.diagnostics.map(item => item.code)).toContain(
        "WF_NODE_UNREACHABLE"
      );
    expect(() => validateState(unreachable, false)).not.toThrow();

    const deadEnd = emptyDefinition();
    deadEnd.nodes.splice(1, 0, {
      id: "dead",
      type: "state",
      name: "死路",
      position: { x: 260, y: 320 },
      config: { nodeDh: "DEAD", jdmc: "死路", flowStatus: "死路" },
    });
    deadEnd.edges.push({
      id: "start-dead",
      sourceNodeId: "start",
      targetNodeId: "dead",
    });
    const deadEndResult = analyzeWorkflowDefinition(deadEnd, {
      flowType: "state",
      executable: true,
    });
    expect(deadEndResult.ok).toBe(false);
    if (!deadEndResult.ok)
      expect(deadEndResult.diagnostics.map(item => item.code)).toContain(
        "WF_NODE_CANNOT_REACH_END"
      );

    const cyclic = emptyDefinition();
    cyclic.nodes.splice(
      1,
      0,
      {
        id: "a",
        type: "state",
        name: "节点 A",
        position: { x: 200, y: 180 },
        config: { nodeDh: "A", jdmc: "节点 A", flowStatus: "节点 A" },
      },
      {
        id: "b",
        type: "state",
        name: "节点 B",
        position: { x: 320, y: 180 },
        config: { nodeDh: "B", jdmc: "节点 B", flowStatus: "节点 B" },
      }
    );
    cyclic.edges = [
      { id: "start-a", sourceNodeId: "start", targetNodeId: "a" },
      { id: "a-b", sourceNodeId: "a", targetNodeId: "b" },
      { id: "b-a", sourceNodeId: "b", targetNodeId: "a" },
      { id: "b-end", sourceNodeId: "b", targetNodeId: "end" },
    ];
    const cyclicResult = analyzeWorkflowDefinition(cyclic, {
      flowType: "state",
      executable: true,
    });
    expect(cyclicResult.ok).toBe(false);
    if (!cyclicResult.ok)
      expect(cyclicResult.diagnostics.map(item => item.code)).toContain(
        "WF_LOOP_NOT_DECLARED"
      );
  });
});
