import {
  readOperateOutcomeMode,
  readOperateOutcomes,
  type NodeConfig,
} from "@shared/workflow-node-contract";
import { isConfigRecord } from "./workflow-config-editor";
import { normalizeReferenceRouterRule } from "@shared/reference-router-config";

type OutgoingEdge = { sourceHandle?: string | null; target: string };
type RouterEdge = OutgoingEdge & { source: string };

/** Keep operation connections attached to their result code when ports change. */
export function updateOperateConnections<T extends RouterEdge>(
  sourceId: string,
  before: NodeConfig,
  requested: NodeConfig,
  edges: T[]
): T[] {
  const explicit = readOperateOutcomeMode(requested) === "explicit";
  const next = explicit ? readOperateOutcomes(requested) : [];
  const handles = new Set(next.map(outcome => outcome.sourceHandle));
  const codes = new Set(next.map(outcome => outcome.code));
  if (handles.size !== next.length || codes.size !== next.length)
    throw new Error("操作结果代号和分支句柄不可重复。");
  const previous =
    readOperateOutcomeMode(before) === "explicit"
      ? readOperateOutcomes(before)
      : [];
  const renamed = new Map(
    previous.flatMap(outcome => {
      const replacement = next.find(item => item.code === outcome.code);
      return replacement
        ? [[outcome.sourceHandle, replacement.sourceHandle] as const]
        : [];
    })
  );
  const allowed = explicit ? handles : new Set(["default"]);
  return edges.flatMap(edge => {
    if (edge.source !== sourceId) return [edge];
    const oldHandle = edge.sourceHandle ?? "default";
    const newHandle = renamed.get(oldHandle) ?? oldHandle;
    if (!allowed.has(newHandle)) return [];
    return [
      newHandle === oldHandle ? edge : { ...edge, sourceHandle: newHandle },
    ];
  });
}

function routeHandle(route: NodeConfig) {
  return String(route.handle ?? route.code ?? "default").trim() || "default";
}

function legacyHandle(
  value: NodeConfig,
  index: number,
  modernHandles: Set<string>
) {
  const route = isConfigRecord(value.route) ? value.route : value;
  const mirroredHandle = String(
    route.handle ?? route.routerRuleId ?? route.code ?? ""
  ).trim();
  return modernHandles.has(mirroredHandle)
    ? mirroredHandle
    : normalizeReferenceRouterRule(value, index).handle;
}

/** Apply explicit rule edits without leaving connections on removed or renamed handles. */
export function updateRouterConnections<T extends RouterEdge>(
  sourceId: string,
  before: NodeConfig,
  requested: NodeConfig,
  edges: T[]
): { config: NodeConfig; edges: T[] } {
  const oldRoutes = Array.isArray(before.routes)
    ? before.routes.filter(isConfigRecord)
    : [];
  const requestedRoutes = Array.isArray(requested.routes)
    ? requested.routes.filter(isConfigRecord)
    : [];
  const oldDefault =
    String(before.defaultRoute ?? "default").trim() || "default";
  const nextDefault =
    String(requested.defaultRoute ?? "default").trim() || "default";
  const renamed = new Map<string, string>();
  const routes = requestedRoutes.map(route =>
    oldDefault !== nextDefault && routeHandle(route) === oldDefault
      ? { ...route, handle: nextDefault }
      : route
  );
  const oldHandles = new Set(oldRoutes.map(routeHandle));
  const nextHandles = new Set(routes.map(routeHandle));
  if (nextHandles.size !== routes.length)
    throw new Error("路由规则的路径句柄不可重复，请为每个分支使用不同名称。");
  if (oldDefault !== nextDefault) renamed.set(oldDefault, nextDefault);
  if (oldRoutes.length === routes.length) {
    oldRoutes.forEach((route, index) => {
      const oldHandle = routeHandle(route);
      const nextHandle = routeHandle(routes[index]);
      if (
        oldHandle !== nextHandle &&
        !nextHandles.has(oldHandle) &&
        !oldHandles.has(nextHandle)
      )
        renamed.set(oldHandle, nextHandle);
    });
  }
  const removed = new Set(
    Array.from(oldHandles).filter(
      handle =>
        !nextHandles.has(handle) &&
        !renamed.has(handle) &&
        handle !== nextDefault
    )
  );
  const nextEdges = edges.flatMap(edge => {
    if (edge.source !== sourceId) return [edge];
    const handle = edge.sourceHandle?.trim() || "default";
    if (removed.has(handle)) return [];
    const nextHandle = renamed.get(handle);
    return [nextHandle ? { ...edge, sourceHandle: nextHandle } : edge];
  });
  const outgoing = nextEdges.filter(edge => edge.source === sourceId);
  const connectedHandles = outgoing.map(edge => edge.sourceHandle || "default");
  if (new Set(connectedHandles).size !== connectedHandles.length)
    throw new Error("新路径句柄已有连线，请选择不同名称以保留两个分支。");
  const lysz = Array.isArray(requested.lysz)
    ? requested.lysz.filter(isConfigRecord).flatMap((value, index) => {
        const nested = isConfigRecord(value.route);
        const route = nested ? (value.route as NodeConfig) : value;
        const handle = legacyHandle(value, index, oldHandles);
        if (removed.has(handle)) return [];
        const nextHandle = renamed.get(handle);
        if (!nextHandle) return [value];
        return [
          nested
            ? { ...value, route: { ...route, handle: nextHandle } }
            : { ...value, handle: nextHandle },
        ];
      })
    : requested.lysz;
  return {
    config: syncRouterConfigTargets({ ...requested, routes, lysz }, outgoing),
    edges: nextEdges,
  };
}
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
    outgoing.map(edge => [edge.sourceHandle?.trim() || "default", edge.target])
  );
  const existingRoutes = Array.isArray(config.routes)
    ? config.routes.filter(isConfigRecord)
    : [];
  const existingLegacy = Array.isArray(config.lysz)
    ? config.lysz.filter(isConfigRecord)
    : [];
  const routes = existingRoutes.map(route => {
    const handle = routeHandle(route);
    const target = targets.get(handle);
    return target
      ? { ...withoutTargets(route), handle, target, targetNodeId: target }
      : withoutTargets(route);
  });
  // Do not introduce modern rules that would override imported legacy conditions.
  if (existingRoutes.length || !existingLegacy.length) {
    for (const [handle, target] of Array.from(targets)) {
      if (!routes.some(route => routeHandle(route) === handle))
        routes.push({
          handle,
          label: handle === "default" ? "默认" : handle,
          target,
          targetNodeId: target,
        });
    }
  }
  const modernHandles = new Set(routes.map(routeHandle));
  const lysz: NodeConfig[] = existingLegacy.map((value, index) => {
    const nested = isConfigRecord(value.route);
    const route = nested ? (value.route as NodeConfig) : value;
    const handle = legacyHandle(value, index, modernHandles);
    const target = targets.get(handle);
    const cleaned = nested
      ? withoutTargets(value)
      : { ...withoutTargets(value), handle };
    const cleanedRoute = { ...withoutTargets(route), handle };
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
      !lysz.some(
        (value, index) => legacyHandle(value, index, modernHandles) === handle
      )
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
