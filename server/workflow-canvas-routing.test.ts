import { describe, expect, it } from "vitest";
import {
  syncRouterConfigTargets,
  updateRouterConnections,
} from "../client/src/components/workflow-canvas-routing";
import { normalizeReferenceRouterConfig } from "../shared/reference-router-config";

describe("画布路由连线同步", () => {
  it("未显式填写句柄的原版规则沿用运行时句柄，断线后保持稳定", () => {
    const config = {
      lysz: [
        {
          route: {
            routerRuleId: "rule1",
            routerTargetId: "review",
            conditions: [
              { left: "{{input.value}}", operator: "equals", right: true },
            ],
          },
        },
      ],
    };
    const connected = syncRouterConfigTargets(config, [
      { sourceHandle: "review", target: "next" },
    ]);
    expect(normalizeReferenceRouterConfig(connected).rules[0]).toMatchObject({
      handle: "review",
      targetNodeId: "next",
    });
    const disconnected = syncRouterConfigTargets(connected, []);
    expect(normalizeReferenceRouterConfig(disconnected).rules[0]).toMatchObject(
      { handle: "review", targetNodeId: "" }
    );
  });
  it("重命名规则同步连线和兼容映射，保留其他节点连线", () => {
    const condition = {
      left: "{{input.amount}}",
      operator: "greaterThan",
      right: 100,
    };
    const before = {
      defaultRoute: "default",
      routes: [{ handle: "high", condition }],
      lysz: [
        {
          route: {
            handle: "high",
            routerRuleId: "id1",
            conditions: [condition],
          },
        },
      ],
    };
    const edges = [
      {
        id: "high-edge",
        source: "router",
        sourceHandle: "high",
        target: "review",
      },
      {
        id: "other-edge",
        source: "other",
        sourceHandle: "high",
        target: "end",
      },
    ];
    const next = updateRouterConnections(
      "router",
      before,
      { ...before, routes: [{ handle: " large ", condition }] },
      edges
    );
    expect(next.edges).toEqual([
      { ...edges[0], sourceHandle: "large" },
      edges[1],
    ]);
    expect(next.config.routes).toEqual([
      { handle: "large", condition, target: "review", targetNodeId: "review" },
    ]);
    expect(next.config.lysz).toEqual([
      {
        routerTargetId: "review",
        routerTargetyId: "review",
        route: {
          handle: "large",
          routerRuleId: "id1",
          conditions: [condition],
          routerTargetId: "review",
        },
      },
    ]);
    expect(edges[0].sourceHandle).toBe("high");
  });

  it("删除规则移除对应连线与兼容映射，保留默认分支", () => {
    const before = {
      defaultRoute: "default",
      routes: [{ handle: "high" }, { handle: "low" }],
      lysz: [{ route: { handle: "high" } }],
    };
    const edges = [
      { source: "router", sourceHandle: "high", target: "review" },
      { source: "router", sourceHandle: "low", target: "end" },
      { source: "router", sourceHandle: "default", target: "end" },
    ];
    const next = updateRouterConnections(
      "router",
      before,
      { ...before, routes: [{ handle: "low" }] },
      edges
    );
    expect(next.edges).toEqual(edges.slice(1));
    expect(
      normalizeReferenceRouterConfig(next.config).rules.map(rule => rule.handle)
    ).not.toContain("high");
  });

  it("默认句柄改名同步默认规则及连线，拒绝重复句柄", () => {
    const before = {
      defaultRoute: "default",
      routes: [{ handle: "default", label: "默认" }],
    };
    const next = updateRouterConnections(
      "router",
      before,
      { ...before, defaultRoute: "fallback" },
      [{ source: "router", sourceHandle: "default", target: "end" }]
    );
    expect(next.edges[0].sourceHandle).toBe("fallback");
    expect(normalizeReferenceRouterConfig(next.config)).toMatchObject({
      defaultRoute: "fallback",
      rules: [{ handle: "fallback", targetNodeId: "end" }],
    });
    expect(() =>
      updateRouterConnections(
        "router",
        before,
        { routes: [{ handle: "same" }, { handle: "same" }] },
        []
      )
    ).toThrow("句柄不可重复");
  });
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
