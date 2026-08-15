import { describe, expect, it } from "vitest";
import { emptyDefinition, validate } from "./workflow-service";

describe("流程定义输入边界", () => {
  it("拒绝缺少节点、未知节点类型、非法位置、数组配置和悬挂连线", () => {
    expect(() => validate({})).toThrow("流程定义格式无效");
    const unknownType = emptyDefinition();
    (unknownType.nodes[0] as any).type = "shell";
    expect(() => validate(unknownType)).toThrow("节点格式或类型无效");
    const invalidPosition = emptyDefinition();
    (invalidPosition.nodes[0] as any).position = { x: "bad", y: 0 };
    expect(() => validate(invalidPosition)).toThrow("节点位置无效");
    const invalidConfig = emptyDefinition();
    (invalidConfig.nodes[0] as any).config = [];
    expect(() => validate(invalidConfig)).toThrow("节点配置必须是 JSON 对象");
    const danglingEdge = emptyDefinition();
    danglingEdge.edges[0]!.targetNodeId = "missing";
    expect(() => validate(danglingEdge)).toThrow("连线引用了不存在的节点");
  });
});
