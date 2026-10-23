import {
  organizationUnitToken,
  organizationMembershipToken,
  organizationMembershipTokens,
  organizationBindingToken,
} from "./organization-configuration";
import mysql from "mysql2/promise";
import { getSharedPool } from "./db";
import { normalizeReferenceOperateConfig } from "../shared/reference-operate-config";
import {
  organizationMemberPageWindow,
  organizationMemberSearchPattern,
} from "./organization-member-pagination";

type JsonRecord = Record<string, unknown>;
const db = () => getSharedPool();

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const asStrings = (value: unknown) =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : [];

export type OrganizationUnitFields = {
  name?: string;
  parentUnitId?: string | null;
  managerUserId?: number | null;
  unitType?: string | null;
  unitLevel?: number | null;
  standardCode?: string | null;
  areaCode?: string | null;
  category?: string | null;
  sortOrder?: number;
  description?: string | null;
  status?: "active" | "disabled";
};

export function attachOrganizationPaths<T>(units: T[]) {
  const records = units as Array<Record<string, any>>;
  const byId = new Map(records.map(unit => [String(unit.id), unit]));
  const cache = new Map<
    string,
    { pathName: string; pathCode: string; displayPath: string }
  >();
  const resolve = (
    unit: Record<string, any>,
    ancestors = new Set<string>()
  ): { pathName: string; pathCode: string; displayPath: string } => {
    const unitId = String(unit.id);
    const cached = cache.get(unitId);
    if (cached) return cached;
    const name = String(unit.name ?? unitId);
    const code = String(unit.code ?? unitId);
    const parentId = unit.parentUnitId ? String(unit.parentUnitId) : null;
    const parent =
      parentId && !ancestors.has(parentId) ? byId.get(parentId) : undefined;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(unitId);
    const parentPath = parent ? resolve(parent, nextAncestors) : null;
    const pathName = parentPath ? `${parentPath.pathName} / ${name}` : name;
    const pathCode = parentPath ? `${parentPath.pathCode}/${code}` : code;
    const result = {
      pathName,
      pathCode,
      displayPath: `${pathName}（${pathCode}）`,
    };
    cache.set(unitId, result);
    return result;
  };
  return records.map(unit => ({ ...unit, ...resolve(unit) })) as T[];
}

export async function listOrganization() {
  const [units] = await db().query<mysql.RowDataPacket[]>(
    "SELECT ou.*,manager.name AS managerName,manager.username AS managerUsername,parent.name AS parentName FROM organization_unit ou LEFT JOIN users manager ON manager.id=ou.managerUserId LEFT JOIN organization_unit parent ON parent.id=ou.parentUnitId ORDER BY ou.status,ou.sortOrder,ou.code"
  );
  const [members] = await db().query<mysql.RowDataPacket[]>(
    "SELECT om.*,u.name,u.username,u.status AS userStatus,ou.name AS unitName FROM organization_membership om JOIN users u ON u.id=om.userId JOIN organization_unit ou ON ou.id=om.unitId ORDER BY ou.code,om.isPrimary DESC,u.name,u.username"
  );
  const [roleBindings] = await db().query<mysql.RowDataPacket[]>(
    "SELECT our.id,our.unitId,our.roleId,our.includeDescendants,our.effectiveFrom,our.expiresAt,our.createdByUserId,our.createdAt,r.code AS roleCode,r.name AS roleName,r.description AS roleDescription,r.scope FROM organization_unit_role our JOIN iam_role r ON r.id=our.roleId ORDER BY r.name,r.code"
  );
  const [directRoleRows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT ra.id AS assignmentId,ra.userId,ra.roleId,ra.scopeType,ra.scopeId,ra.expiresAt,
            r.code AS roleCode,r.name AS roleName
       FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId
      WHERE ra.scopeType='system' AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW()
        AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
      ORDER BY r.name,r.code`
  );
  const [inheritedRoleRows] = await db().query<mysql.RowDataPacket[]>(
    `WITH RECURSIVE membership_units AS (
       SELECT om.userId,ou.id AS memberUnitId,ou.id AS unitId,ou.parentUnitId,0 AS depth
         FROM organization_membership om
         JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
       UNION ALL
       SELECT mu.userId,mu.memberUnitId,parent.id,parent.parentUnitId,mu.depth+1
         FROM membership_units mu
         JOIN organization_unit parent ON parent.id=mu.parentUnitId AND parent.status='active'
        WHERE mu.depth<32
     )
     SELECT DISTINCT mu.userId,our.unitId,ou.name AS unitName,our.roleId,
            r.code AS roleCode,r.name AS roleName
       FROM membership_units mu
       JOIN organization_unit_role our ON our.unitId=mu.unitId
         AND our.effectiveFrom<=NOW() AND (our.expiresAt IS NULL OR our.expiresAt>NOW())
       JOIN organization_unit ou ON ou.id=our.unitId
       JOIN iam_role r ON r.id=our.roleId
      WHERE mu.unitId=mu.memberUnitId OR our.includeDescendants=1
      ORDER BY ou.name,r.name,r.code`
  );
  const directRolesByUser = new Map<number, mysql.RowDataPacket[]>();
  const inheritedRolesByUser = new Map<number, mysql.RowDataPacket[]>();
  for (const role of directRoleRows) {
    const userId = Number(role.userId);
    directRolesByUser.set(userId, [
      ...(directRolesByUser.get(userId) ?? []),
      role,
    ]);
  }
  for (const role of inheritedRoleRows) {
    const userId = Number(role.userId);
    inheritedRolesByUser.set(userId, [
      ...(inheritedRolesByUser.get(userId) ?? []),
      role,
    ]);
  }
  const unitsWithPaths = attachOrganizationPaths(units) as Array<
    mysql.RowDataPacket & {
      pathName?: string;
      pathCode?: string;
      displayPath?: string;
    }
  >;
  const unitPaths = new Map(
    unitsWithPaths.map(unit => [String(unit.id), unit])
  );
  const membershipTokens = organizationMembershipTokens(members);
  return {
    units: unitsWithPaths.map(unit => ({
      ...unit,
      configToken: organizationUnitToken(unit),
    })),
    members: members.map(member => ({
      ...member,
      membershipToken: membershipTokens.get(Number(member.userId))!,
      unitCode: unitPaths.get(String(member.unitId))?.code,
      unitPathName: unitPaths.get(String(member.unitId))?.pathName,
      unitPathCode: unitPaths.get(String(member.unitId))?.pathCode,
      unitDisplayPath: unitPaths.get(String(member.unitId))?.displayPath,
      directRoles: directRolesByUser.get(Number(member.userId)) ?? [],
      inheritedRoles: (
        inheritedRolesByUser.get(Number(member.userId)) ?? []
      ).map(role => ({
        ...role,
        unitCode: unitPaths.get(String(role.unitId))?.code,
        unitDisplayPath: unitPaths.get(String(role.unitId))?.displayPath,
      })),
    })),
    roleBindings: roleBindings.map(binding => ({
      ...binding,
      configToken: organizationBindingToken(binding),
      unitCode: unitPaths.get(String(binding.unitId))?.code,
      unitDisplayPath: unitPaths.get(String(binding.unitId))?.displayPath,
    })),
  };
}

export async function listOrganizationDirectory() {
  const [units] = await db().query<mysql.RowDataPacket[]>(
    "SELECT ou.*,manager.name AS managerName,manager.username AS managerUsername,parent.name AS parentName FROM organization_unit ou LEFT JOIN users manager ON manager.id=ou.managerUserId LEFT JOIN organization_unit parent ON parent.id=ou.parentUnitId ORDER BY ou.status,ou.sortOrder,ou.code"
  );
  const [memberCounts] = await db().query<mysql.RowDataPacket[]>(
    "SELECT unitId,COUNT(*) AS memberCount FROM organization_membership GROUP BY unitId"
  );
  const [unassignedActiveUsers] = await db().query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS unassignedCount FROM users u WHERE u.status='active' AND NOT EXISTS (SELECT 1 FROM organization_membership om WHERE om.userId=u.id)"
  );
  const [roleBindings] = await db().query<mysql.RowDataPacket[]>(
    "SELECT our.id,our.unitId,our.roleId,our.includeDescendants,our.effectiveFrom,our.expiresAt,our.createdByUserId,our.createdAt,r.code AS roleCode,r.name AS roleName,r.description AS roleDescription,r.scope FROM organization_unit_role our JOIN iam_role r ON r.id=our.roleId ORDER BY r.name,r.code"
  );
  const unitsWithPaths = attachOrganizationPaths(units) as Array<
    mysql.RowDataPacket & {
      pathName?: string;
      pathCode?: string;
      displayPath?: string;
    }
  >;
  const memberCountByUnit = new Map<string, number>();
  for (const row of memberCounts)
    memberCountByUnit.set(String(row.unitId), Number(row.memberCount));
  const unitPaths = new Map(
    unitsWithPaths.map(unit => [String(unit.id), unit])
  );
  return {
    units: unitsWithPaths.map(unit => ({
      ...unit,
      configToken: organizationUnitToken(unit),
      memberCount: memberCountByUnit.get(String(unit.id)) ?? 0,
    })),
    unassignedActiveUserCount: Number(
      unassignedActiveUsers[0]?.unassignedCount ?? 0
    ),
    roleBindings: roleBindings.map(binding => ({
      ...binding,
      configToken: organizationBindingToken(binding),
      unitCode: unitPaths.get(String(binding.unitId))?.code,
      unitDisplayPath: unitPaths.get(String(binding.unitId))?.displayPath,
    })),
  };
}

export async function listOrganizationMembersPage(input: {
  unitId: string;
  includeDescendants: boolean;
  search: string;
  page: number;
  pageSize: number;
}) {
  const searchPattern = organizationMemberSearchPattern(input.search);
  const unitScopeCte = input.includeDescendants
    ? `WITH RECURSIVE unit_scope(id,parentUnitId,depth) AS (
         SELECT id,parentUnitId,0 FROM organization_unit WHERE id=?
         UNION ALL
         SELECT child.id,child.parentUnitId,parent.depth+1
           FROM organization_unit child JOIN unit_scope parent ON child.parentUnitId=parent.id
          WHERE parent.depth<99
       )`
    : "";
  const unitScopeFilter = input.includeDescendants
    ? "om.unitId IN (SELECT id FROM unit_scope)"
    : "om.unitId=?";
  const where = searchPattern
    ? `${unitScopeFilter} AND CONCAT_WS(' ',COALESCE(u.name,''),u.username,COALESCE(om.title,'')) LIKE ? ESCAPE '='`
    : unitScopeFilter;
  const baseValues: Array<string | number> = [input.unitId];
  if (searchPattern) baseValues.push(searchPattern);
  const [countRows] = await db().query<mysql.RowDataPacket[]>(
    `${unitScopeCte} SELECT COUNT(*) AS total FROM organization_membership om JOIN users u ON u.id=om.userId WHERE ${where}`,
    baseValues
  );
  const total = Number(countRows[0]?.total ?? 0);
  const page = organizationMemberPageWindow(input.page, input.pageSize, total);
  const [memberRows] = await db().query<mysql.RowDataPacket[]>(
    `${unitScopeCte} SELECT om.*,u.name,u.username,u.status AS userStatus,ou.name AS unitName,
      (SELECT JSON_ARRAYAGG(JSON_OBJECT('id',allm.id,'unitId',allm.unitId,'userId',allm.userId,'title',allm.title,'isPrimary',allm.isPrimary)) FROM organization_membership allm WHERE allm.userId=om.userId) AS membershipState
      FROM organization_membership om JOIN users u ON u.id=om.userId JOIN organization_unit ou ON ou.id=om.unitId WHERE ${where} ORDER BY ou.code,om.isPrimary DESC,u.name,u.username,u.id,om.id LIMIT ? OFFSET ?`,
    [...baseValues, page.pageSize, page.offset]
  );
  const userIds = Array.from(
    new Set(memberRows.map(row => Number(row.userId)).filter(Number.isFinite))
  );
  if (!userIds.length)
    return {
      items: [],
      total,
      ...page,
      unitId: input.unitId,
      includeDescendants: input.includeDescendants,
      search: input.search.trim(),
    };

  const placeholders = userIds.map(() => "?").join(",");
  const [directRoleRows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT ra.id AS assignmentId,ra.userId,ra.roleId,ra.scopeType,ra.scopeId,ra.expiresAt,r.code AS roleCode,r.name AS roleName FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId WHERE ra.userId IN (${placeholders}) AND ra.scopeType='system' AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW()) ORDER BY r.name,r.code`,
    userIds
  );
  const [inheritedRoleRows] = await db().query<mysql.RowDataPacket[]>(
    `WITH RECURSIVE membership_units(userId,memberUnitId,unitId,parentUnitId,depth) AS (
       SELECT om.userId,ou.id AS memberUnitId,ou.id AS unitId,ou.parentUnitId,0 AS depth
         FROM organization_membership om
         JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
        WHERE om.userId IN (${placeholders})
       UNION ALL
       SELECT mu.userId,mu.memberUnitId,parent.id,parent.parentUnitId,mu.depth+1
         FROM membership_units mu
         JOIN organization_unit parent ON parent.id=mu.parentUnitId AND parent.status='active'
        WHERE mu.depth<32
     )
     SELECT DISTINCT mu.userId,our.unitId,ou.name AS unitName,our.roleId,
            r.code AS roleCode,r.name AS roleName
       FROM membership_units mu
       JOIN organization_unit_role our ON our.unitId=mu.unitId
         AND our.effectiveFrom<=NOW() AND (our.expiresAt IS NULL OR our.expiresAt>NOW())
       JOIN organization_unit ou ON ou.id=our.unitId
       JOIN iam_role r ON r.id=our.roleId
      WHERE mu.unitId=mu.memberUnitId OR our.includeDescendants=1
      ORDER BY ou.name,r.name,r.code`,
    userIds
  );
  const [unitRows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,code,name,parentUnitId FROM organization_unit"
  );
  const unitsWithPaths = attachOrganizationPaths(unitRows) as Array<
    mysql.RowDataPacket & {
      pathName?: string;
      pathCode?: string;
      displayPath?: string;
    }
  >;
  const unitPaths = new Map(
    unitsWithPaths.map(unit => [String(unit.id), unit])
  );
  const directRolesByUser = new Map<number, mysql.RowDataPacket[]>();
  const inheritedRolesByUser = new Map<number, mysql.RowDataPacket[]>();
  for (const role of directRoleRows) {
    const userId = Number(role.userId);
    directRolesByUser.set(userId, [
      ...(directRolesByUser.get(userId) ?? []),
      role,
    ]);
  }
  for (const role of inheritedRoleRows) {
    const userId = Number(role.userId);
    inheritedRolesByUser.set(userId, [
      ...(inheritedRolesByUser.get(userId) ?? []),
      role,
    ]);
  }
  return {
    items: memberRows.map(member => ({
      ...member,
      membershipState: undefined,
      membershipToken: organizationMembershipToken(
        Number(member.userId),
        typeof member.membershipState === "string"
          ? JSON.parse(member.membershipState)
          : (member.membershipState ?? [])
      ),
      unitCode: unitPaths.get(String(member.unitId))?.code,
      unitPathName: unitPaths.get(String(member.unitId))?.pathName,
      unitPathCode: unitPaths.get(String(member.unitId))?.pathCode,
      unitDisplayPath: unitPaths.get(String(member.unitId))?.displayPath,
      directRoles: directRolesByUser.get(Number(member.userId)) ?? [],
      inheritedRoles: (
        inheritedRolesByUser.get(Number(member.userId)) ?? []
      ).map(role => ({
        ...role,
        unitCode: unitPaths.get(String(role.unitId))?.code,
        unitDisplayPath: unitPaths.get(String(role.unitId))?.displayPath,
      })),
    })),
    total,
    ...page,
    unitId: input.unitId,
    includeDescendants: input.includeDescendants,
    search: input.search.trim(),
  };
}

export async function organizationMemberConfiguration(userId: number) {
  // A single statement keeps the displayed memberships and their token in one snapshot.
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT u.id,u.name,u.username,u.status,(SELECT JSON_ARRAYAGG(JSON_OBJECT('id',om.id,'unitId',om.unitId,'userId',om.userId,'title',om.title,'isPrimary',om.isPrimary,'unitName',ou.name,'unitCode',ou.code,'unitStatus',ou.status)) FROM organization_membership om JOIN organization_unit ou ON ou.id=om.unitId WHERE om.userId=u.id) AS membershipState FROM users u WHERE u.id=? LIMIT 1",
    [userId]
  );
  const user = rows[0];
  const memberships = user
    ? typeof user.membershipState === "string"
      ? JSON.parse(user.membershipState)
      : (user.membershipState ?? [])
    : [];
  return {
    user: user
      ? {
          id: Number(user.id),
          name: user.name,
          username: user.username,
          status: user.status,
        }
      : null,
    memberships: memberships as Array<Record<string, any>>,
    membershipToken: organizationMembershipToken(userId, memberships),
  };
}

// Writes share one transaction and current authorization check.
export {
  createOrganizationUnit,
  updateOrganizationUnit,
  assignOrganizationMember,
  removeOrganizationMember,
  setPrimaryOrganizationMembership,
  moveOrganizationMember,
  deleteOrganizationUnit,
  bindOrganizationRole,
  unbindOrganizationRole,
} from "./organization-write-service";

// Read-only assignee fallback validation; write paths validate locked accounts.
async function assertActiveUser(userId: number, label: string) {
  const [users] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id FROM users WHERE id=? AND status='active' LIMIT 1",
    [userId]
  );
  if (!users[0]) throw new Error(label + "不存在或已停用。");
}

export async function resolveDirectManagerUserId(userId: number) {
  const [memberships] = await db().query<mysql.RowDataPacket[]>(
    "SELECT om.unitId,ou.managerUserId,ou.parentUnitId FROM organization_membership om JOIN organization_unit ou ON ou.id=om.unitId WHERE om.userId=? AND ou.status='active' ORDER BY om.isPrimary DESC,om.createdAt LIMIT 1",
    [userId]
  );
  let unit = memberships[0];
  if (!unit) return null;
  for (let depth = 0; unit && depth < 32; depth += 1) {
    const managerUserId = Number(unit.managerUserId);
    if (
      Number.isInteger(managerUserId) &&
      managerUserId > 0 &&
      managerUserId !== userId
    ) {
      const [managers] = await db().query<mysql.RowDataPacket[]>(
        "SELECT id FROM users WHERE id=? AND status='active' LIMIT 1",
        [managerUserId]
      );
      if (managers[0]) return managerUserId;
    }
    if (!unit.parentUnitId) return null;
    const [parents] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id AS unitId,managerUserId,parentUnitId FROM organization_unit WHERE id=? AND status='active' LIMIT 1",
      [unit.parentUnitId]
    );
    unit = parents[0];
  }
  return null;
}

/** Resolve the Nth active manager in the employee's organization chain. */
export async function resolveNthManagerUserId(userId: number, level = 1) {
  const depth = Math.min(Math.max(Math.trunc(Number(level) || 1), 1), 32);
  let currentUserId = userId;
  for (let index = 0; index < depth; index += 1) {
    const managerUserId = await resolveDirectManagerUserId(currentUserId);
    if (!managerUserId) return null;
    currentUserId = managerUserId;
  }
  return currentUserId;
}

export async function resolveRoleCandidateUserIds(
  roleCode: string,
  workflowId: string
) {
  if (!roleCode.trim()) return [];
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `WITH RECURSIVE membership_units AS (
       SELECT om.userId,ou.id AS memberUnitId,ou.id AS unitId,ou.parentUnitId,0 AS depth
         FROM organization_membership om
         JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
       UNION ALL
       SELECT mu.userId,mu.memberUnitId,parent.id,parent.parentUnitId,mu.depth+1
         FROM membership_units mu
         JOIN organization_unit parent ON parent.id=mu.parentUnitId AND parent.status='active'
        WHERE mu.depth<32
     )
     SELECT DISTINCT u.id
       FROM users u
       JOIN (
         SELECT ra.userId FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId
          WHERE r.code=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
            AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=?))
         UNION
         SELECT mu.userId FROM membership_units mu
           JOIN organization_unit_role our ON our.unitId=mu.unitId
             AND our.effectiveFrom<=NOW() AND (our.expiresAt IS NULL OR our.expiresAt>NOW())
           JOIN iam_role r ON r.id=our.roleId
          WHERE r.code=? AND (mu.unitId=mu.memberUnitId OR our.includeDescendants=1)
       ) eligible ON eligible.userId=u.id
      WHERE u.status='active' ORDER BY u.id`,
    [roleCode.trim(), workflowId, roleCode.trim()]
  );
  return rows
    .map(row => Number(row.id))
    .filter(id => Number.isInteger(id) && id > 0);
}

export async function resolveDepartmentCandidateUserIds(
  unitIds: string[],
  includeDescendants = true
) {
  const ids = Array.from(
    new Set(
      unitIds
        .map(String)
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    includeDescendants
      ? `WITH RECURSIVE selected_units AS (
           SELECT id FROM organization_unit WHERE id IN (${placeholders}) AND status='active'
           UNION ALL
           SELECT child.id FROM organization_unit child JOIN selected_units parent ON child.parentUnitId=parent.id
            WHERE child.status='active'
         )
         SELECT DISTINCT u.id FROM selected_units su
           JOIN organization_membership om ON om.unitId=su.id
           JOIN users u ON u.id=om.userId AND u.status='active' ORDER BY u.id`
      : `SELECT DISTINCT u.id FROM organization_membership om
           JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
           JOIN users u ON u.id=om.userId AND u.status='active'
          WHERE om.unitId IN (${placeholders}) ORDER BY u.id`,
    ids
  );
  return rows
    .map(row => Number(row.id))
    .filter(id => Number.isInteger(id) && id > 0);
}

export async function resolveDepartmentManagerUserIds(unitIds: string[]) {
  const ids = Array.from(
    new Set(
      unitIds
        .map(String)
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT u.id FROM organization_unit ou
       JOIN users u ON u.id=ou.managerUserId AND u.status='active'
      WHERE ou.id IN (${placeholders}) AND ou.status='active' ORDER BY u.id`,
    ids
  );
  return rows
    .map(row => Number(row.id))
    .filter(id => Number.isInteger(id) && id > 0);
}

async function resolvePrimaryUnitIds(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT unitId FROM organization_membership WHERE userId=? ORDER BY isPrimary DESC,createdAt LIMIT 1",
    [userId]
  );
  return rows.map(row => String(row.unitId)).filter(Boolean);
}

function participantFormUserIds(context: JsonRecord, field: string) {
  const segments = field
    .split(".")
    .map(item => item.trim())
    .filter(Boolean);
  let value: unknown = context;
  for (const segment of segments) value = asRecord(value)[segment];
  const values = Array.isArray(value) ? value : [value];
  return values.map(Number).filter(id => Number.isInteger(id) && id > 0);
}

export const PARTICIPANT_RESOLVER_MODES = [
  "receivers",
  "user",
  "initiator",
  "initiator_manager",
  "sender_manager",
  "initiator_manager_n",
  "sender_manager_n",
  "role",
  "department",
  "department_manager",
  "form_user",
] as const;

export async function resolveWorkflowUserRoleKeys(
  userIds: number[],
  workflowId: string
) {
  const uniqueUserIds = Array.from(
    new Set(userIds.filter(id => Number.isInteger(id) && id > 0))
  );
  const result = new Map<number, string[]>(
    uniqueUserIds.map(userId => [userId, ["default"]])
  );
  if (!uniqueUserIds.length) return result;
  const placeholders = uniqueUserIds.map(() => "?").join(",");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `WITH RECURSIVE membership_units AS (
       SELECT om.userId,ou.id AS memberUnitId,ou.id AS unitId,ou.parentUnitId,0 AS depth
         FROM organization_membership om
         JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
        WHERE om.userId IN (${placeholders})
       UNION ALL
       SELECT mu.userId,mu.memberUnitId,parent.id,parent.parentUnitId,mu.depth+1
         FROM membership_units mu
         JOIN organization_unit parent ON parent.id=mu.parentUnitId AND parent.status='active'
        WHERE mu.depth<32
     )
     SELECT DISTINCT eligible.userId,r.id AS roleId,r.code
       FROM (
         SELECT ra.userId,ra.roleId FROM role_assignment ra
          WHERE ra.userId IN (${placeholders}) AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
            AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=?))
         UNION
         SELECT mu.userId,our.roleId FROM membership_units mu
           JOIN organization_unit_role our ON our.unitId=mu.unitId
             AND our.effectiveFrom<=NOW() AND (our.expiresAt IS NULL OR our.expiresAt>NOW())
          WHERE mu.unitId=mu.memberUnitId OR our.includeDescendants=1
       ) eligible JOIN iam_role r ON r.id=eligible.roleId JOIN users u ON u.id=eligible.userId AND u.status='active'`,
    [...uniqueUserIds, ...uniqueUserIds, workflowId]
  );
  for (const row of rows) {
    const userId = Number(row.userId);
    const roleCode = String(row.code || "").trim();
    if (result.has(userId) && roleCode)
      result.set(
        userId,
        Array.from(
          new Set([...(result.get(userId) ?? []), roleCode, String(row.roleId)])
        )
      );
  }
  return result;
}

export async function resolveOperateAssignees(input: {
  config: JsonRecord;
  context: JsonRecord;
  workflowId: string;
}) {
  const runtime = asRecord(input.context.runtime);
  const initiatorUserId = Number(runtime.triggeredByUserId);
  const senderUserId = Number(
    runtime.lastActorUserId || runtime.triggeredByUserId
  );
  let mode = String(input.config.assigneeMode || "");
  const legacyText = JSON.stringify({
    qxkz: input.config.qxkz,
    bddx: input.config.bddx,
    sxsz: input.config.sxsz,
  });
  if (!mode && /direct_manager|直属上级|upperAuthUnitWord/.test(legacyText))
    mode = "initiator_manager";
  if (!mode) mode = input.config.assigneeUserId ? "user" : "receivers";
  // Legacy open-claim nodes are narrowed to the authenticated run initiator.
  // A human task must always have an explicit current owner/candidate snapshot.
  if (mode === "none") mode = "initiator";

  let candidates: number[] = [];
  const resolverRegistry: Record<string, () => Promise<number[]> | number[]> = {
    receivers: () =>
      Array.isArray(runtime.receiverUserIds)
        ? runtime.receiverUserIds.map(Number)
        : [],
    user: () => [Number(input.config.assigneeUserId)],
    initiator: () => [initiatorUserId],
    initiator_manager: async () => [
      Number(await resolveDirectManagerUserId(initiatorUserId)),
    ],
    sender_manager: async () => [
      Number(await resolveDirectManagerUserId(senderUserId)),
    ],
    initiator_manager_n: async () => [
      Number(
        await resolveNthManagerUserId(
          initiatorUserId,
          Number(input.config.managerLevel ?? input.config.supervisorLevel ?? 2)
        )
      ),
    ],
    sender_manager_n: async () => [
      Number(
        await resolveNthManagerUserId(
          senderUserId,
          Number(input.config.managerLevel ?? input.config.supervisorLevel ?? 2)
        )
      ),
    ],
    role: () =>
      resolveRoleCandidateUserIds(
        String(input.config.assigneeRoleCode || ""),
        input.workflowId
      ),
    department: () =>
      resolveDepartmentCandidateUserIds(
        Array.isArray(input.config.assigneeUnitIds)
          ? input.config.assigneeUnitIds.map(String)
          : [],
        input.config.includeDescendants !== false
      ),
    department_manager: async () => {
      const configured = Array.isArray(input.config.assigneeUnitIds)
        ? input.config.assigneeUnitIds.map(String)
        : [];
      const unitIds = configured.length
        ? configured
        : await resolvePrimaryUnitIds(initiatorUserId);
      return resolveDepartmentManagerUserIds(unitIds);
    },
    form_user: () =>
      participantFormUserIds(
        input.context,
        String(input.config.assigneeFormField || "input.userId")
      ),
  };
  if (resolverRegistry[mode]) candidates = await resolverRegistry[mode]!();
  else if (/^(initiator|sender)_manager_[0-9]+$/.test(mode)) {
    const [, subject, levelText] =
      mode.match(/^(initiator|sender)_manager_([0-9]+)$/) ?? [];
    candidates = [
      Number(
        await resolveNthManagerUserId(
          subject === "sender" ? senderUserId : initiatorUserId,
          Number(levelText)
        )
      ),
    ];
  }

  candidates = Array.from(
    new Set(candidates.filter(id => Number.isInteger(id) && id > 0))
  );
  const excluded: Array<{ userId: number; reason: string }> = [];
  if (candidates.length) {
    const [active] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE id IN (?) AND status='active'",
      [candidates]
    );
    const activeIds = new Set(active.map(row => Number(row.id)));
    for (const userId of candidates)
      if (!activeIds.has(userId))
        excluded.push({ userId, reason: "不存在或已停用" });
    if (excluded.length === candidates.length) candidates = [];
    else if (excluded.length)
      throw new Error(
        "部分操作候选人不存在或已停用，请调整人员配置，审批要求不会自动降低。"
      );
  }
  let fallbackApplied: string | undefined;
  if (candidates.length === 0) {
    const fallback = String(input.config.assigneeFallback ?? "error").trim();
    if (
      fallback === "initiator" &&
      Number.isInteger(initiatorUserId) &&
      initiatorUserId > 0
    ) {
      candidates = [initiatorUserId];
      fallbackApplied = "initiator";
    } else if (fallback === "owner") {
      const [ownerRows] = await db().query<mysql.RowDataPacket[]>(
        "SELECT ownerUserId FROM workflow WHERE id=? LIMIT 1",
        [input.workflowId]
      );
      const ownerUserId = Number(ownerRows[0]?.ownerUserId);
      if (Number.isInteger(ownerUserId) && ownerUserId > 0)
        candidates = [ownerUserId];
      if (candidates.length) fallbackApplied = "owner";
    }
    if (candidates.length === 0)
      throw new Error("操作节点未解析到有效处理人，且未配置可用兜底策略。");
  }
  if (fallbackApplied) await assertActiveUser(candidates[0]!, "兜底处理人");
  return {
    mode,
    assignedUserId: candidates.length === 1 ? candidates[0] : null,
    candidateUserIds: candidates,
    resolvedAt: new Date().toISOString(),
    selector: {
      kind: mode,
      unitIds: Array.isArray(input.config.assigneeUnitIds)
        ? input.config.assigneeUnitIds.map(String)
        : undefined,
      roleCode:
        mode === "role"
          ? String(input.config.assigneeRoleCode || "")
          : undefined,
      formField:
        mode === "form_user"
          ? String(input.config.assigneeFormField || "input.userId")
          : undefined,
    },
    excluded,
    fallbackApplied,
  };
}

export async function resolveAutoRelatedParticipantUserIds(
  config: JsonRecord,
  context: JsonRecord
) {
  const autoRelatedParty =
    normalizeReferenceOperateConfig(config).autoRelatedParty;
  if (!autoRelatedParty.includes("upperAuthUnitWord")) return [];
  const runtime = asRecord(context.runtime);
  const sources = [
    Number(runtime.lastActorUserId || runtime.triggeredByUserId),
  ].filter(id => Number.isInteger(id) && id > 0);
  const managers = await Promise.all(
    Array.from(new Set(sources)).map(resolveDirectManagerUserId)
  );
  return Array.from(
    new Set(
      managers.filter(
        (id): id is number => Number.isInteger(id) && Number(id) > 0
      )
    )
  );
}
