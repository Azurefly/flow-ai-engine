import type { NodeConfig } from "@shared/workflow-node-contract";
import { isConfigRecord } from "./workflow-config-editor";

type OutgoingEdge = { sourceHandle?: string | null; target: string };
const targetKeys = [
  "target",
  "targetNodeId",
  "routerTargetId",
  "routerTargetyId",
];

function withoutTargets(value: NodeConfig): NodeConfig {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !targetKeys.includes(key))
  );
}

/** Connections own target references; rules retain their conditions when disconnected. */
export function syncRouterConfigTargets(
  config: NodeConfig,
  outgoing: OutgoingEdge[]
): NodeConfig {
  const targets = new Map(
    outgoing.map(edge => [edge.sourceHandle || "default", edge.target])
  );
  const existingRoutes = Array.isArray(config.routes)
    ? config.routes.filter(isConfigRecord)
    : [];
  const existingLegacy = Array.isArray(config.lysz)
    ? config.lysz.filter(isConfigRecord)
    : [];
  const routes = existingRoutes.map(route => {
    const handle = String(route.handle ?? route.code ?? "default");
    const target = targets.get(handle);
    return target
      ? { ...withoutTargets(route), handle, target, targetNodeId: target }
      : withoutTargets(route);
  });
  // Do not introduce modern rules that would override imported legacy conditions.
  if (existingRoutes.length || !existingLegacy.length) {
    for (const [handle, target] of Array.from(targets)) {
      if (
        !routes.some(
          route => String(route.handle ?? route.code ?? "default") === handle
        )
      )
        routes.push({
          handle,
          label: handle === "default" ? "默认" : handle,
          target,
          targetNodeId: target,
        });
    }
  }
  const lysz: NodeConfig[] = existingLegacy.map(value => {
    const nested = isConfigRecord(value.route);
    const route = nested ? (value.route as NodeConfig) : value;
    const handle = String(
      route.handle ?? route.routerRuleId ?? route.code ?? "default"
    );
    const target = targets.get(handle);
    const cleaned = withoutTargets(value);
    const cleanedRoute = withoutTargets(route);
    return target
      ? {
          ...cleaned,
          routerTargetId: target,
          routerTargetyId: target,
          ...(nested
            ? { route: { ...cleanedRoute, routerTargetId: target } }
            : {}),
        }
      : { ...cleaned, ...(nested ? { route: cleanedRoute } : {}) };
  });
  for (const [handle, target] of Array.from(targets)) {
    if (
      !lysz.some(value => {
        const route = isConfigRecord(value.route) ? value.route : value;
        return (
          String(
            route.handle ?? route.routerRuleId ?? route.code ?? "default"
          ) === handle
        );
      })
    )
      lysz.push({
        routerTargetId: target,
        routerTargetyId: target,
        route: {
          handle,
          routerRuleId: handle,
          routerRuleName: handle,
          routerTargetId: target,
        },
      });
  }
  return { ...config, routes, lysz };
}
