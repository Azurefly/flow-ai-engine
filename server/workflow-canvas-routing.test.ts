import { describe, expect, it } from "vitest";
import { syncRouterConfigTargets } from "../client/src/components/workflow-canvas-routing";
import { normalizeReferenceRouterConfig } from "../shared/reference-router-config";

describe("画布路由连线同步", () => {
  it("逐条连线时保留其他待连接规则和条件", () => {
    const pending = {
      handle: "low",
      label: "常规",
      condition: { left: "{{input.amount}}", operator: "lessThan", right: 100 },
      extension: { retained: true },
    };
    const config = { routes: [{ handle: "high", label: "大额" }, pending] };
    const next = syncRouterConfigTargets(config, [
      { sourceHandle: "high", target: "review" },
    ]);
    expect(next.routes).toEqual([
      {
        handle: "high",
        label: "大额",
        target: "review",
        targetNodeId: "review",
      },
      pending,
    ]);
    expect(config.routes[0]).not.toHaveProperty("target");
  });

  it("断开分支只清除目标引用，重新连线后条件与扩展字段仍在", () => {
    const condition = {
      left: "{{input.amount}}",
      operator: "greaterThan",
      right: 100,
    };
    const config = {
      routes: [
        {
          handle: "high",
          condition,
          target: "old",
          targetNodeId: "old",
          routerTargetId: "old",
          extra: "keep",
        },
      ],
    };
    const disconnected = syncRouterConfigTargets(config, []);
    expect(disconnected.routes).toEqual([
      { handle: "high", condition, extra: "keep" },
    ]);
    const reconnected = syncRouterConfigTargets(disconnected, [
      { sourceHandle: "high", target: "new" },
    ]);
    expect(reconnected.routes).toEqual([
      {
        handle: "high",
        condition,
        extra: "keep",
        target: "new",
        targetNodeId: "new",
      },
    ]);
  });

  it("原版规则保留条件，不被自动创建的现代规则覆盖", () => {
    const condition = {
      left: "{{input.amount}}",
      operator: "greaterThan",
      right: 100,
    };
    const config = {
      routes: [],
      lysz: [
        {
          route: {
            handle: "high",
            routerRuleId: "rule1",
            conditions: [condition],
            routerTargetId: "old",
          },
          extension: true,
        },
      ],
    };
    const next = syncRouterConfigTargets(config, [
      { sourceHandle: "high", target: "new" },
    ]);
    expect(next.routes).toEqual([]);
    expect(normalizeReferenceRouterConfig(next).rules[0]).toMatchObject({
      handle: "high",
      targetNodeId: "new",
      conditions: [condition],
    });
    const disconnected = syncRouterConfigTargets(next, []);
    expect(normalizeReferenceRouterConfig(disconnected).rules[0]).toMatchObject(
      { handle: "high", targetNodeId: "", conditions: [condition] }
    );
  });
});
