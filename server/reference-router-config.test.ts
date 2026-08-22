import { describe, expect, it } from "vitest";
import { normalizeReferenceRouterConfig } from "../shared/reference-router-config";

describe("原版路由配置转换", () => {
  it("读取画布 lysz、广播、优先级、目标节点、角色和条件关系", () => {
    const result = normalizeReferenceRouterConfig({
      gbms: true,
      lysz: [
        {
          routerTargetyId: "manager-state",
          route: {
            routerRuleId: "rule-manager",
            routerRuleName: "经理分支",
            routerRulePriority: "100",
            routerTargetId: "manager-state",
            routerJavaCodeAndAuthGroupsRelation: "||",
            routerAuthGroups: [{ authReceiver: { receiverRole: ["manager"] } }],
            conditions: [{ left: "{{input.amount}}", operator: "greaterThan", right: 3 }],
          },
        },
        { route: { routerRuleId: "default", routerRulePriority: -1, routerTargetId: "fallback" } },
      ],
    });

    expect(result.broadcast).toBe(true);
    expect(result.rules[0]).toMatchObject({
      ruleId: "rule-manager",
      priority: 100,
      handle: "manager-state",
      targetNodeId: "manager-state",
      roleKeys: ["manager"],
      relation: "or",
      isDefault: false,
    });
    expect(result.rules[1]).toMatchObject({ priority: -1, isDefault: true, targetNodeId: "fallback" });
  });

  it("优先使用当前安全 routes 并保留历史任意代码阻断标记", () => {
    const modern = normalizeReferenceRouterConfig({
      routes: [{ handle: "approved", priority: 9, condition: { left: "{{input.status}}", operator: "equals", right: "approved" } }],
      lysz: [{ route: { routerTargetId: "legacy", routerJavaCode: "return true;" } }],
    });
    expect(modern.rules).toHaveLength(1);
    expect(modern.rules[0]).toMatchObject({ handle: "approved", hasUnsafeCode: false });

    const legacy = normalizeReferenceRouterConfig({
      routes: [],
      lysz: [{ route: { routerTargetId: "legacy", routerJavaCode: "return true;" } }],
    });
    expect(legacy.hasUnsafeCode).toBe(true);
  });
});
