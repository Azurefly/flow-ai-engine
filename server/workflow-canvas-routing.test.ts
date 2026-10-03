import { describe, expect, it } from "vitest";
import {
  syncRouterConfigTargets,
  updateRouterConnections,
  updateOperateConnections,
  updateLlmConnections,
} from "../client/src/components/workflow-canvas-routing";
import { normalizeReferenceRouterConfig } from "../shared/reference-router-config";

describe("LLM 失败分支连线同步", () => {
  const edges = [
    { source: "llm", sourceHandle: "default", target: "success" },
    { source: "llm", sourceHandle: "failed", target: "review" },
    { source: "other", sourceHandle: "failed", target: "review" },
  ];
  it("修改及清除失败出口时保留成功分支和其他节点的连线", () => {
    expect(
      updateLlmConnections(
        "llm",
        { failureHandle: "failed" },
        { failureHandle: " error " },
        edges
      )
    ).toEqual([edges[0], { ...edges[1], sourceHandle: "error" }, edges[2]]);
    expect(
      updateLlmConnections(
        "llm",
        { failureHandle: "failed" },
        { failureHandle: "" },
        edges
      )
    ).toEqual([edges[0], edges[2]]);
    expect(edges[1].sourceHandle).toBe("failed");
  });
  it("阻止失败与成功同名，新增失败出口不移动已有成功连线", () => {
    expect(() =>
      updateLlmConnections("llm", {}, { failureHandle: "default" }, edges)
    ).toThrow("不能与成功分支");
    expect(
      updateLlmConnections("llm", {}, { failureHandle: "failed" }, [edges[0]])
    ).toEqual([edges[0]]);
  });
});

describe("人工操作结果连线同步", () => {
  const before = {
    outcomeMode: "explicit",
    outcomes: [
      { code: "approve", label: "同意", sourceHandle: "approved" },
      { code: "reject", label: "拒绝", sourceHandle: "rejected" },
    ],
  };
  const edges = [
    { source: "review", sourceHandle: "approved", target: "finish" },
    { source: "review", sourceHandle: "rejected", target: "revise" },
    { source: "other", sourceHandle: "approved", target: "finish" },
  ];
  it("按结果代号保留改名及重排后的分支目标，删除结果时清理对应连线", () => {
    const changed = {
      ...before,
      outcomes: [
        before.outcomes[1],
        { ...before.outcomes[0], sourceHandle: "accepted" },
      ],
    };
    expect(updateOperateConnections("review", before, changed, edges)).toEqual([
      { ...edges[0], sourceHandle: "accepted" },
      edges[1],
      edges[2],
    ]);
    expect(
      updateOperateConnections(
        "review",
        before,
        { ...before, outcomes: [before.outcomes[1]] },
        edges
      )
    ).toEqual([edges[1], edges[2]]);
    expect(edges[0].sourceHandle).toBe("approved");
  });
  it("重复代号或句柄阻止更新，切换旧模式不保留失效的显式出口", () => {
    expect(() =>
      updateOperateConnections(
        "review",
        before,
        { ...before, outcomes: [before.outcomes[0], before.outcomes[0]] },
        edges
      )
    ).toThrow("不可重复");
    expect(
      updateOperateConnections(
        "review",
        before,
        { outcomeMode: "legacy_cancel" },
        edges
      )
    ).toEqual([edges[2]]);
  });
});

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
