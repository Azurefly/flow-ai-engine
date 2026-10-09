import { expect, it } from "vitest";
import { locateSubflowDiagnostics } from "./subflow-diagnostics";
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
