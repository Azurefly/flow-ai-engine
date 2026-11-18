import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { ParticipantRouteCondition } from "../shared/participant-route-condition";
import { compareCondition, interpolate } from "./workflow-routing";

export type ParticipantDepartment = {
  unitId: string;
  ancestorIds: string[];
  isPrimary: boolean;
};

/** All department facts for an operation are read through its transaction. */
export async function resolveParticipantDepartments(
  connection: PoolConnection,
  userIds: number[],
  selectedUnitIds: string[]
) {
  const result = new Map<number, ParticipantDepartment[]>();
  if (!userIds.length) return result;
  const [units] = await connection.query<RowDataPacket[]>(
    "SELECT id,parentUnitId FROM organization_unit WHERE status='active'"
  );
  const parents = new Map(
    units.map(unit => [
      String(unit.id),
      unit.parentUnitId ? String(unit.parentUnitId) : null,
    ])
  );
  if (selectedUnitIds.some(unitId => !parents.has(unitId)))
    throw new Error("路由条件引用的部门不存在或已停用，请更新流程部门条件。");
  const [memberships] = await connection.query<RowDataPacket[]>(
    "SELECT unitId,userId,isPrimary FROM organization_membership WHERE userId IN (?) ORDER BY userId,unitId",
    [userIds]
  );
  for (const membership of memberships) {
    const unitId = String(membership.unitId);
    if (!parents.has(unitId)) continue;
    const ancestorIds: string[] = [];
    const visited = new Set<string>();
    let current: string | null = unitId;
    while (current && parents.has(current)) {
      if (visited.has(current))
        throw new Error("组织部门存在循环，无法计算人员路由层级。");
      visited.add(current);
      ancestorIds.push(current);
      current = parents.get(current) ?? null;
    }
    const userId = Number(membership.userId);
    const entries = result.get(userId) ?? [];
    entries.push({
      unitId,
      ancestorIds,
      isPrimary: Boolean(membership.isPrimary),
    });
    result.set(userId, entries);
  }
  return result;
}

export function matchesParticipantCondition(
  condition: ParticipantRouteCondition,
  input: {
    userId: number;
    roleKeys: string[];
    stateCode: string | null;
    departments: ParticipantDepartment[];
    context: Record<string, unknown>;
    identities: Record<string, unknown>;
  }
): boolean {
  let matched: boolean;
  switch (condition.kind) {
    case "group":
      matched =
        condition.match === "all"
          ? condition.conditions.every(child =>
              matchesParticipantCondition(child, input)
            )
          : condition.conditions.some(child =>
              matchesParticipantCondition(child, input)
            );
      break;
    case "identity":
      matched = input.identities[condition.identity] === true;
      break;
    case "role":
      matched =
        condition.match === "all"
          ? condition.roleKeys.every(role => input.roleKeys.includes(role))
          : condition.roleKeys.some(role => input.roleKeys.includes(role));
      break;
    case "user":
      matched = condition.userIds.includes(input.userId);
      break;
    case "department":
      matched = input.departments.some(
        department =>
          (condition.membership === "any" || department.isPrimary) &&
          condition.unitIds.some(rootId => {
            const depth = department.ancestorIds.indexOf(rootId);
            return (
              depth >= condition.minDepth &&
              (condition.maxDepth === null || depth <= condition.maxDepth)
            );
          })
      );
      break;
    case "state":
      matched =
        input.stateCode !== null &&
        condition.stateCodes.includes(input.stateCode);
      break;
    case "data":
      matched = compareCondition(
        interpolate(condition.left, input.context),
        condition.operator,
        interpolate(condition.right, input.context)
      );
      break;
  }
  return condition.negate ? !matched : matched;
}
