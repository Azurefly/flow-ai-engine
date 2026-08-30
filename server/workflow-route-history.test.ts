import { describe, expect, it } from "vitest";
import {
  restoreRouterRouteConfig,
  snapshotRouterRouteConfig,
} from "../client/src/lib/workflow-route-history";

const routerConfig = {
  defaultRoute: "approved",
  routes: [
    {
      handle: "approved",
      label: "通过",
      target: "approved-node",
      targetNodeId: "approved-node",
      priority: 100,
      roleKeys: ["manager"],
      condition: {
        left: "{{input.status}}",
        operator: "equals",
        right: "approved",
      },
    },
    {
      handle: "rejected",
      label: "驳回",
      target: "rejected-node",
      targetNodeId: "rejected-node",
      priority: 10,
      roleKeys: ["auditor"],
    },
  ],
  lysz: [
    {
      routerTargetId: "approved-node",
      routerTargetyId: "approved-node",
      route: {
        routerRuleId: "approved",
        routerRuleName: "通过",
        routerRulePriority: 100,
        routerTargetId: "approved-node",
        routerAuthGroups: [{ authReceiver: { receiverRole: ["manager"] } }],
        routerJavaCodeAndAuthGroupsRelation: "&&",
      },
    },
    {
      routerTargetId: "rejected-node",
      route: {
        routerRuleId: "rejected",
        routerRuleName: "驳回",
        routerRulePriority: 10,
        routerTargetId: "rejected-node",
      },
    },
  ],
};

describe("路由连线撤销配置快照", () => {
  it("完整恢复 modern routes 与 legacy lysz 的受影响 handle", () => {
    const snapshot = snapshotRouterRouteConfig(routerConfig, "approved");
    const afterDelete = {
      ...routerConfig,
      routes: routerConfig.routes.filter(route => route.handle !== "approved"),
      lysz: routerConfig.lysz.filter(
        entry => entry.route.routerRuleId !== "approved"
      ),
    };

    expect(restoreRouterRouteConfig(afterDelete, "approved", snapshot)).toEqual(
      routerConfig
    );
  });

  it("只恢复被删除 handle，不覆盖其他路由在删除后的修改", () => {
    const snapshot = snapshotRouterRouteConfig(routerConfig, "approved");
    const afterDeleteAndEdit = {
      ...routerConfig,
      routes: [
        {
          ...routerConfig.routes[1],
          label: "驳回（已调整）",
          roleKeys: ["compliance"],
        },
        {
          handle: "manual",
          label: "人工分支",
          target: "manual-node",
          priority: 1,
        },
      ],
      lysz: [
        {
          ...routerConfig.lysz[1],
          route: {
            ...routerConfig.lysz[1].route,
            routerRuleName: "驳回（已调整）",
            routerRulePriority: 20,
          },
        },
      ],
    };

    const restored = restoreRouterRouteConfig(
      afterDeleteAndEdit,
      "approved",
      snapshot
    );

    expect(restored.routes).toEqual([
      routerConfig.routes[0],
      {
        ...routerConfig.routes[1],
        label: "驳回（已调整）",
        roleKeys: ["compliance"],
      },
      {
        handle: "manual",
        label: "人工分支",
        target: "manual-node",
        priority: 1,
      },
    ]);
    expect(restored.lysz).toEqual([
      routerConfig.lysz[0],
      {
        ...routerConfig.lysz[1],
        route: {
          ...routerConfig.lysz[1].route,
          routerRuleName: "驳回（已调整）",
          routerRulePriority: 20,
        },
      },
    ]);
  });
});
