import { describe, expect, it } from "vitest";
import {
  bindParallelJoin,
  setRouterBroadcast,
} from "./workflow-parallel-binding";
import { normalizeReferenceRouterConfig } from "./reference-router-config";

describe("并行汇聚配置", () => {
  it("兼容并行字段的开关保持一致，旧 broadcast 可关闭", () => {
    const config = { broadcast: true, parallelJoinNodeId: "join" };
    const disabled = setRouterBroadcast(config, false);
    expect(normalizeReferenceRouterConfig(disabled).broadcast).toBe(false);
    expect(disabled.parallelJoinNodeId).toBe("join");
    expect(
      normalizeReferenceRouterConfig(setRouterBroadcast(disabled, true))
        .broadcast
    ).toBe(true);
  });
  const nodes = [
    { id: "router", config: { parallelJoinNodeId: "old", routes: ["keep"] } },
    { id: "old", config: { parallelForNodeId: "router", value: 1 } },
    { id: "new", config: { value: 2 } },
  ];
  it("切换汇聚节点时解除旧绑定并同步新绑定，保持其他配置", () => {
    expect(bindParallelJoin(nodes, "router", "new")).toEqual({
      router: { parallelJoinNodeId: "new", routes: ["keep"] },
      old: { parallelForNodeId: "", value: 1 },
      new: { parallelForNodeId: "router", value: 2 },
    });
    expect(nodes[1].config.parallelForNodeId).toBe("router");
  });
  it("清空时解除反向绑定", () => {
    expect(bindParallelJoin(nodes, "router", "").old.parallelForNodeId).toBe(
      ""
    );
  });
  it("拒绝自身、缺失节点及其他路由已占用的汇聚节点", () => {
    for (const id of ["router", "missing"])
      expect(() => bindParallelJoin(nodes, "router", id)).toThrow();
    expect(() =>
      bindParallelJoin(
        [...nodes, { id: "occupied", config: { parallelForNodeId: "other" } }],
        "router",
        "occupied"
      )
    ).toThrow("已绑定其他");
  });
});
