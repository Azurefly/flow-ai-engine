import {
  normalizeReferenceRouterConfig,
  type NormalizedRouterRule,
} from "../shared/reference-router-config";
type JsonRecord = Record<string, unknown>;
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function getPath(context: unknown, path: string): unknown {
  const segments = path
    .trim()
    .replace(/^\$\.?/, "")
    .split(".")
    .filter(Boolean);
  let value: unknown = context;
  for (const segment of segments) {
    if (Array.isArray(value) && /^\d+$/.test(segment))
      value = value[Number(segment)];
    else if (value && typeof value === "object")
      value = (value as JsonRecord)[segment];
    else return undefined;
  }
  return value;
}

/** Resolves {{input.topic}} and {{nodes.http-1.body.title}} without executing arbitrary expressions. */
export function interpolate(value: unknown, context: JsonRecord): unknown {
  if (typeof value !== "string") return value;
  const exact = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (exact) return getPath(context, exact[1]);
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => {
    const resolved = getPath(context, path);
    return resolved === undefined || resolved === null
      ? ""
      : typeof resolved === "string"
        ? resolved
        : JSON.stringify(resolved);
  });
}

export function resolveTemplates(value: unknown, context: JsonRecord): unknown {
  if (Array.isArray(value))
    return value.map(item => resolveTemplates(item, context));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, item]) => [
        key,
        resolveTemplates(item, context),
      ])
    );
  return interpolate(value, context);
}

export function compareCondition(
  left: unknown,
  operator: string,
  right: unknown
) {
  switch (operator) {
    case "equals":
      return left === right;
    case "notEquals":
      return left !== right;
    case "contains":
      return typeof left === "string"
        ? left.includes(String(right ?? ""))
        : Array.isArray(left)
          ? left.includes(right)
          : false;
    case "exists":
      return left !== undefined && left !== null && left !== "";
    case "greaterThan":
      return Number(left) > Number(right);
    case "lessThan":
      return Number(left) < Number(right);
    default:
      throw new Error(`条件节点不支持操作符：${operator}`);
  }
}

export function routerRuleMatches(
  rule: NormalizedRouterRule,
  context: JsonRecord,
  roleKeys: string[]
) {
  if (rule.hasUnsafeCode)
    throw new Error("路由规则包含原版任意代码，必须迁移为安全条件后才能运行。");
  const hasRoleFilter = rule.roleKeys.length > 0;
  const roleMatched =
    !hasRoleFilter || rule.roleKeys.some(role => roleKeys.includes(role));
  const hasConditions = rule.conditions.length > 0;
  const conditionsMatched =
    !hasConditions ||
    rule.conditions.every(condition =>
      compareCondition(
        interpolate(condition.left, context),
        condition.operator,
        interpolate(condition.right, context)
      )
    );
  if (rule.relation === "or" && (hasRoleFilter || hasConditions)) {
    return (
      (hasRoleFilter && roleMatched) || (hasConditions && conditionsMatched)
    );
  }
  return roleMatched && conditionsMatched;
}

/**
 * 按原版语义为每个当前人员分别匹配路由。非广播模式每人只进入首个命中分支，
 * 广播模式允许同一人员进入多个分支；权重越大越优先，-1 为默认规则。
 */
export function selectRouterRoutes(
  config: JsonRecord,
  context: JsonRecord,
  participantUserIds: number[] = [],
  roleKeysByUser: Map<number, string[]> = new Map()
) {
  const resolved = asRecord(resolveTemplates(config, context));
  const normalized = normalizeReferenceRouterConfig(resolved);
  const participants = Array.from(
    new Set(participantUserIds.filter(id => Number.isInteger(id) && id > 0))
  );
  const assignments = new Map<
    string,
    { handle: string; targetNodeId: string; userIds: number[] }
  >();
  const addAssignment = (
    rule: Pick<NormalizedRouterRule, "handle" | "targetNodeId">,
    userId: number
  ) => {
    const key = `${rule.handle}\u0000${rule.targetNodeId}`;
    const current = assignments.get(key) ?? {
      handle: rule.handle,
      targetNodeId: rule.targetNodeId,
      userIds: [],
    };
    if (!current.userIds.includes(userId)) current.userIds.push(userId);
    assignments.set(key, current);
  };

  if (participants.length) {
    const ordinaryRules = normalized.rules.filter(rule => !rule.isDefault);
    const defaultRule = normalized.rules.find(rule => rule.isDefault);
    for (const userId of participants) {
      const roles = Array.from(
        new Set(["default", ...(roleKeysByUser.get(userId) ?? [])])
      );
      let matched = false;
      for (const rule of ordinaryRules) {
        if (!routerRuleMatches(rule, context, roles)) continue;
        matched = true;
        addAssignment(rule, userId);
        if (!normalized.broadcast) break;
      }
      if (!matched) {
        const fallback = defaultRule ?? {
          handle: String(interpolate(normalized.defaultRoute, context)),
          targetNodeId: "",
        };
        addAssignment(fallback, userId);
      }
    }
  } else {
    const matches = normalized.rules.filter(
      rule => !rule.isDefault && routerRuleMatches(rule, context, ["default"])
    );
    const fallback = normalized.rules.find(rule => rule.isDefault) ?? {
      handle: String(interpolate(normalized.defaultRoute, context)),
      targetNodeId: "",
    };
    const selected = matches.length
      ? normalized.broadcast
        ? matches
        : matches.slice(0, 1)
      : [fallback];
    for (const rule of selected)
      assignments.set(`${rule.handle}\u0000${rule.targetNodeId}`, {
        handle: rule.handle,
        targetNodeId: rule.targetNodeId,
        userIds: [],
      });
  }

  const selectedBranches = Array.from(assignments.values());
  return {
    broadcast: normalized.broadcast,
    rules: normalized.rules,
    selectedBranches,
    selectedRoutes: Array.from(
      new Set(selectedBranches.map(branch => branch.handle))
    ),
    selectedRoute: selectedBranches[0]?.handle ?? normalized.defaultRoute,
  };
}

/** 兼容旧调用方的单一路由返回结构。 */
export function selectRouterRoute(config: JsonRecord, context: JsonRecord) {
  return selectRouterRoutes(config, context);
}
