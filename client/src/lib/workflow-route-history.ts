export type RouterRouteRecord = Record<string, unknown>;

type RouteFieldSnapshot = {
  present: boolean;
  entries: Array<{ index: number; value: RouterRouteRecord }>;
};

export type RouterRouteConfigSnapshot = {
  routes: RouteFieldSnapshot;
  lysz: RouteFieldSnapshot;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asRecord(value: unknown): RouterRouteRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RouterRouteRecord)
    : null;
}

function modernHandle(value: unknown) {
  const route = asRecord(value);
  return String(route?.handle ?? route?.code ?? "default");
}

function legacyHandle(value: unknown) {
  const record = asRecord(value);
  const route = asRecord(record?.route) ?? record;
  return String(
    route?.handle ?? route?.routerRuleId ?? route?.code ?? "default"
  );
}

function snapshotField(
  config: RouterRouteRecord,
  key: "routes" | "lysz",
  readHandle: (value: unknown) => string,
  handle: string
): RouteFieldSnapshot {
  const value = config[key];
  return {
    present: Object.prototype.hasOwnProperty.call(config, key),
    entries: Array.isArray(value)
      ? value.flatMap((item, index) => {
          const record = asRecord(item);
          return record && readHandle(record) === handle
            ? [{ index, value: clone(record) }]
            : [];
        })
      : [],
  };
}

/** Capture only the route entries affected by removing one outgoing handle. */
export function snapshotRouterRouteConfig(
  config: RouterRouteRecord,
  handle: string
): RouterRouteConfigSnapshot {
  return {
    routes: snapshotField(config, "routes", modernHandle, handle),
    lysz: snapshotField(config, "lysz", legacyHandle, handle),
  };
}

function restoreField(
  config: RouterRouteRecord,
  key: "routes" | "lysz",
  snapshot: RouteFieldSnapshot,
  readHandle: (value: unknown) => string,
  handle: string
) {
  const current = config[key];
  const currentPresent = Object.prototype.hasOwnProperty.call(config, key);
  if (!Array.isArray(current) && !snapshot.entries.length)
    return { present: currentPresent, value: current };

  const kept = (Array.isArray(current) ? current : []).filter(
    item => readHandle(item) !== handle
  );
  const restored = kept.slice();
  for (const entry of snapshot.entries) {
    const index = Math.min(Math.max(entry.index, 0), restored.length);
    restored.splice(index, 0, clone(entry.value));
  }

  if (!restored.length && !snapshot.present)
    return { present: false, value: undefined };
  return { present: true, value: restored };
}

/**
 * Restore one handle's exact entries while retaining current edits to every
 * other route. The caller can atomically replace the router config with the
 * returned object.
 */
export function restoreRouterRouteConfig(
  config: RouterRouteRecord,
  handle: string,
  snapshot: RouterRouteConfigSnapshot
): RouterRouteRecord {
  const next = { ...config };
  const routes = restoreField(
    config,
    "routes",
    snapshot.routes,
    modernHandle,
    handle
  );
  const lysz = restoreField(
    config,
    "lysz",
    snapshot.lysz,
    legacyHandle,
    handle
  );
  if (routes.present) next.routes = routes.value;
  else delete next.routes;
  if (lysz.present) next.lysz = lysz.value;
  else delete next.lysz;
  return next;
}
