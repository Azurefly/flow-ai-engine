export type RouterJsonRecord = Record<string, unknown>;

export type SafeRouterCondition = {
  left: unknown;
  operator: string;
  right?: unknown;
};

export type NormalizedRouterRule = {
  ruleId: string;
  name: string;
  priority: number;
  createdAt: number;
  handle: string;
  targetNodeId: string;
  roleKeys: string[];
  relation: "and" | "or";
  conditions: SafeRouterCondition[];
  isDefault: boolean;
  hasUnsafeCode: boolean;
};

function asRecord(value: unknown): RouterJsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RouterJsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => {
          if (typeof value === "string" || typeof value === "number") return String(value).trim();
          const item = asRecord(value);
          return firstText(item.roleCode, item.roleKey, item.code, item.id, item.key, item.value);
        })
        .filter(Boolean),
    ),
  );
}

function roleKeysFromAuthGroups(value: unknown) {
  const keys: unknown[] = [];
  for (const rawGroup of asArray(value)) {
    const group = asRecord(rawGroup);
    const receiver = asRecord(group.authReceiver);
    keys.push(...asArray(receiver.receiverRole), ...asArray(group.routerAuthGroupIds));
    for (const rawFilter of asArray(receiver.filters)) {
      const filter = asRecord(rawFilter);
      const type = firstText(filter.authReceiverKeyType).toLowerCase();
      if (type.includes("role")) keys.push(...asArray(filter.authReceiverKeys));
    }
  }
  return uniqueStrings(keys);
}

function normalizeConditions(value: unknown): SafeRouterCondition[] {
  return asArray(value)
    .map(asRecord)
    .filter((item) => item.left !== undefined && item.operator !== undefined)
    .map((item) => ({ left: item.left, operator: String(item.operator), ...(item.right === undefined ? {} : { right: item.right }) }));
}

function hasLegacyCode(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (typeof item === "string") return item.trim().length > 0;
    const record = asRecord(item);
    return firstText(record.code, record.value, record.content).length > 0;
  });
}

function normalizeRule(raw: unknown, index: number): NormalizedRouterRule {
  const wrapper = asRecord(raw);
  const route = Object.keys(asRecord(wrapper.route)).length ? asRecord(wrapper.route) : wrapper;
  const priorityValue = Number(route.routerRulePriority ?? route.priority ?? wrapper.routerRulePriority ?? wrapper.priority ?? 0);
  const priority = Number.isFinite(priorityValue) ? priorityValue : 0;
  const targetNodeId = firstText(route.routerTargetId, wrapper.routerTargetyId, wrapper.routerTargetId, route.targetNodeId, route.target, wrapper.targetNodeId, wrapper.target);
  const handle = firstText(route.handle, route.code, wrapper.handle, wrapper.code, targetNodeId, `route-${index + 1}`);
  const condition = asRecord(route.condition);
  const conditions = Object.keys(condition).length ? normalizeConditions([condition]) : normalizeConditions(route.conditions ?? wrapper.conditions ?? wrapper.tjsz);
  const relationValue = firstText(route.routerJavaCodeAndAuthGroupsRelation, route.relation, wrapper.relation).toLowerCase();
  const roleKeys = uniqueStrings([
    ...asArray(route.roleKeys ?? route.authRoleKeys ?? wrapper.roleKeys ?? wrapper.authRoleKeys),
    ...asArray(route.routerAuthGroupIds),
    ...roleKeysFromAuthGroups(route.routerAuthGroups),
  ]);
  const unsafeCode = hasLegacyCode(route.routerJavaCode) || hasLegacyCode(wrapper.codeBlock);
  const createdAtValue = Date.parse(firstText(route.routerCreateTime, route.createdAt));
  return {
    ruleId: firstText(route.routerRuleId, route.id, wrapper.id, handle),
    name: firstText(route.routerRuleName, route.label, wrapper.label, handle),
    priority,
    createdAt: Number.isFinite(createdAtValue) ? createdAtValue : index,
    handle,
    targetNodeId,
    roleKeys,
    relation: relationValue === "||" || relationValue === "or" || relationValue === "或" ? "or" : "and",
    conditions,
    isDefault: priority === -1 || route.isDefault === true || wrapper.isDefault === true,
    hasUnsafeCode: unsafeCode,
  };
}

export function normalizeReferenceRouterConfig(config: RouterJsonRecord) {
  const originalRules = asArray(config.lysz);
  const modernRules = asArray(config.routes);
  const source = modernRules.length ? modernRules : originalRules;
  const rules = source
    .map(normalizeRule)
    .sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt);
  return {
    broadcast: config.gbms === true || config.gbms === "true" || config.broadcast === true || config.broadcast === "true",
    defaultRoute: firstText(config.defaultRoute, "default"),
    rules,
    hasUnsafeCode: rules.some((rule) => rule.hasUnsafeCode),
  };
}
