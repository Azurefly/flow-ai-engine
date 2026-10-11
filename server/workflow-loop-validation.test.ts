import { describe, expect, it } from "vitest";
import {
  analyzeWorkflowDefinition,
  hashWorkflowExecutionPlan,
  assertWorkflowExecutionPlan,
  type WorkflowDefinition,
} from "./workflow-compiler";

function fixture(
  flowType: "state" | "control",
  boundInner: boolean
): WorkflowDefinition {
  const node = (id: string, type: "start" | "end" | "state" | "transform") => ({
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    config: type === "state" ? { stateCode: id, displayName: id } : {},
  });
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      node("start", "start"),
      ...["a", "b", "c"].map(id =>
        node(id, flowType === "state" ? "state" : "transform")
      ),
      node("end", "end"),
    ],
    edges: [
      { id: "start-a", sourceNodeId: "start", targetNodeId: "a" },
      { id: "a-b", sourceNodeId: "a", targetNodeId: "b" },
      { id: "b-c", sourceNodeId: "b", targetNodeId: "c" },
      {
        id: "c-a",
        sourceNodeId: "c",
        targetNodeId: "a",
        loop: { maxIterations: 2 },
      },
      {
        id: "c-b",
        sourceNodeId: "c",
        targetNodeId: "b",
        ...(boundInner ? { loop: { maxIterations: 3 } } : {}),
      },
      { id: "c-end", sourceNodeId: "c", targetNodeId: "end" },
    ],
  };
}

describe("所有回路必须受次数上限约束", () => {
  it("已发布的旧版执行计划仍按原始哈希验证，新草稿标记新版编译器", () => {
    const result = analyzeWorkflowDefinition(fixture("control", true), {
      flowType: "control",
      executable: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.compilerVersion).toBe("1.7.0");
    const legacy = { ...result.plan, compilerVersion: "1.6.0" as const };
    expect(
      assertWorkflowExecutionPlan(
        legacy,
        hashWorkflowExecutionPlan(legacy),
        "control"
      )
    ).toEqual(legacy);
  });
  it.each(["state", "control"] as const)(
    "%s：同一区域中的有界回路不能掩盖无界回路",
    flowType => {
      const result = analyzeWorkflowDefinition(fixture(flowType, false), {
        flowType,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "WF_LOOP_NOT_BOUNDED",
          location: { kind: "edge", edgeId: "b-c", field: "loop" },
        })
      );
      const diagnostic = result.diagnostics.find(
        item => item.code === "WF_LOOP_NOT_BOUNDED"
      )!;
      expect(diagnostic.message).toContain("b、c");
      expect(diagnostic.message).not.toContain("a、");
    }
  );

  it.each(["state", "control"] as const)(
    "%s：所有回路声明上限后不再报告遗漏，运行仍等待完整执行支持",
    flowType => {
      const definition = fixture(flowType, true);
      const result = analyzeWorkflowDefinition(definition, { flowType });
      expect(result.diagnostics.map(item => item.code)).not.toContain(
        "WF_LOOP_NOT_BOUNDED"
      );
      expect(result.diagnostics.map(item => item.code)).toContain(
        "WF_RUNTIME_LOOP_UNSUPPORTED"
      );
      const draft = analyzeWorkflowDefinition(definition, {
        flowType,
        executable: false,
      });
      expect(draft.ok).toBe(true);
      if (draft.ok)
        expect(draft.plan.topologicalOrder).toEqual([
          "start",
          "a",
          "b",
          "c",
          "end",
        ]);
    }
  );

  it("独立的有界区域不能改变另一个未声明区域的诊断", () => {
    const definition = fixture("control", true);
    definition.nodes.push(
      ...["x", "y"].map(id => ({
        id,
        type: "transform" as const,
        name: id,
        position: { x: 0, y: 0 },
        config: {},
      }))
    );
    definition.edges.push(
      { id: "a-x", sourceNodeId: "a", targetNodeId: "x" },
      { id: "x-y", sourceNodeId: "x", targetNodeId: "y" },
      { id: "y-x", sourceNodeId: "y", targetNodeId: "x" },
      { id: "y-end", sourceNodeId: "y", targetNodeId: "end" }
    );
    const result = analyzeWorkflowDefinition(definition, {
      flowType: "control",
    });
    expect(result.diagnostics.map(item => item.code)).toContain(
      "WF_LOOP_NOT_DECLARED"
    );
    expect(result.diagnostics.map(item => item.code)).not.toContain(
      "WF_LOOP_NOT_BOUNDED"
    );
  });

  it("连线输入顺序改变时仍定位同一条遗漏边", () => {
    const definition = fixture("control", false);
    const first = analyzeWorkflowDefinition(definition, {
      flowType: "control",
    });
    const second = analyzeWorkflowDefinition(
      { ...definition, edges: [...definition.edges].reverse() },
      { flowType: "control" }
    );
    expect(
      second.diagnostics.find(item => item.code === "WF_LOOP_NOT_BOUNDED")
    ).toEqual(
      first.diagnostics.find(item => item.code === "WF_LOOP_NOT_BOUNDED")
    );
  });
});
