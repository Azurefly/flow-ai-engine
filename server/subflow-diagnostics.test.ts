import { expect, it } from "vitest";
import { diagnoseSynchronousSubflowNodes, locateSubflowDiagnostics } from "./subflow-diagnostics";
import type { WorkflowCompileDiagnostic } from "./workflow-compiler";
it.each(["node", "edge", "definition"] as const)(
  "内部 %s 错误定位父画布调用节点",
  kind => {
    const source: WorkflowCompileDiagnostic = {
      code: "WF_TEST",
      message: "内部路由目标不存在",
      location: {
        kind,
        nodeId: "inner",
        edgeId: "inner-edge",
        field: "config.routes",
      },
    };
    const original = structuredClone(source);
    const [result] = locateSubflowDiagnostics(
      [source],
      { id: "child", name: "订单核对" },
      "核对规则"
    );
    expect(result.code).toBe("WF_TEST");
    expect(result.message).toContain("订单核对");
    expect(result.message).toContain("核对规则");
    expect(result.message).toContain(source.message);
    expect(result.location).toEqual({
      kind: "node",
      nodeId: "child",
      field: "config.subflowId",
    });
    expect(source).toEqual(original);
  }
);
it.each(["wait", "message_catch", "operate", "sql", "subflow", "unknown"])(
  "同步子流程 %s 节点在发布前定位调用节点", type => {
    const result = locateSubflowDiagnostics(
      diagnoseSynchronousSubflowNodes([{ id: "inner", type, name: "内部步骤" }]),
      { id: "caller", name: "校验订单" }, "订单规则"
    );
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("WF_SUBFLOW_SYNC_NODE_UNSUPPORTED");
    expect(result[0].location.nodeId).toBe("caller");
    expect(result[0].message).toContain(type);
    expect(result[0].message).toContain("主流程");
  }
);
it("同步执行器支持的节点不误报", () => {
  expect(diagnoseSynchronousSubflowNodes(["start", "state", "milestone", "form", "router", "rest", "method", "transform", "condition", "http", "llm", "end"].map(type => ({ id: type, name: type, type })))).toEqual([]);
});
