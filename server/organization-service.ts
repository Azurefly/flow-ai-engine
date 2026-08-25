import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { normalizeReferenceOperateConfig } from "../shared/reference-operate-config";
import { recordAuthorizationAudit } from "./iam-service";

type User = { id: number; role: "user" | "admin" };
type JsonRecord = Record<string, unknown>;
let pool: mysql.Pool | undefined;
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
};

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

const cleanOptional = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

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
  return {
    units: unitsWithPaths,
    members: members.map(member => ({
      ...member,
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
      unitCode: unitPaths.get(String(binding.unitId))?.code,
      unitDisplayPath: unitPaths.get(String(binding.unitId))?.displayPath,
    })),
  };
}

export async function createOrganizationUnit(
  user: User,
  input: { code: string; name: string } & Omit<
    OrganizationUnitFields,
    "name" | "status"
  >
) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(code))
    throw new Error(
      "组织单元代号须以字母开头，且仅包含大写字母、数字、下划线或连字符。"
    );
  let parentLevel: number | null = null;
  if (input.parentUnitId) {
    const [parents] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id,unitLevel FROM organization_unit WHERE id=? AND status='active' LIMIT 1",
      [input.parentUnitId]
    );
    if (!parents[0]) throw new Error("上级组织单元不存在或已停用。");
    parentLevel =
      parents[0].unitLevel === null ? null : Number(parents[0].unitLevel);
  }
  if (input.managerUserId)
    await assertActiveUser(input.managerUserId, "负责人");
  const id = randomUUID();
  const unitLevel =
    input.unitLevel ??
    (parentLevel === null ? (input.parentUnitId ? 2 : 1) : parentLevel + 1);
  await db().query(
    "INSERT INTO organization_unit (id,code,name,parentUnitId,managerUserId,unitType,unitLevel,standardCode,areaCode,category,sortOrder,description,createdByUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      code,
      input.name.trim(),
      input.parentUnitId ?? null,
      input.managerUserId ?? null,
      cleanOptional(input.unitType) ?? null,
      unitLevel,
      cleanOptional(input.standardCode) ?? null,
      cleanOptional(input.areaCode) ?? null,
      cleanOptional(input.category) ?? null,
      input.sortOrder ?? 0,
      cleanOptional(input.description) ?? null,
      user.id,
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "organization_unit",
    resourceId: id,
    details: { operation: "organization_unit_created", code },
  });
  return id;
}

export async function updateOrganizationUnit(
  user: User,
  input: { id: string } & OrganizationUnitFields
) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM organization_unit WHERE id=? LIMIT 1",
    [input.id]
  );
  const unit = rows[0];
  if (!unit) throw new Error("组织单元不存在。");
  if (input.parentUnitId === input.id)
    throw new Error("组织单元不能把自身设为上级。");
  if (input.parentUnitId) {
    const [parents] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM organization_unit WHERE id=? AND status='active' LIMIT 1",
      [input.parentUnitId]
    );
    if (!parents[0]) throw new Error("上级组织单元不存在或已停用。");
    let cursor: string | null = input.parentUnitId;
    for (let depth = 0; cursor && depth < 32; depth += 1) {
      if (cursor === input.id) throw new Error("组织单元层级不能形成循环。");
      const ancestorResult = await db().query<mysql.RowDataPacket[]>(
        "SELECT parentUnitId FROM organization_unit WHERE id=? LIMIT 1",
        [cursor]
      );
      const ancestorRows: mysql.RowDataPacket[] = ancestorResult[0];
      cursor = ancestorRows[0]?.parentUnitId
        ? String(ancestorRows[0].parentUnitId)
        : null;
    }
  }
  if (input.managerUserId)
    await assertActiveUser(input.managerUserId, "负责人");
  await db().query(
    "UPDATE organization_unit SET name=?,parentUnitId=?,managerUserId=?,unitType=?,unitLevel=?,standardCode=?,areaCode=?,category=?,sortOrder=?,description=?,status=?,updatedAt=NOW() WHERE id=?",
    [
      input.name?.trim() || unit.name,
      input.parentUnitId === undefined ? unit.parentUnitId : input.parentUnitId,
      input.managerUserId === undefined
        ? unit.managerUserId
        : input.managerUserId,
      cleanOptional(input.unitType) === undefined
        ? unit.unitType
        : cleanOptional(input.unitType),
      input.unitLevel === undefined ? unit.unitLevel : input.unitLevel,
      cleanOptional(input.standardCode) === undefined
        ? unit.standardCode
        : cleanOptional(input.standardCode),
      cleanOptional(input.areaCode) === undefined
        ? unit.areaCode
        : cleanOptional(input.areaCode),
      cleanOptional(input.category) === undefined
        ? unit.category
        : cleanOptional(input.category),
      input.sortOrder === undefined ? unit.sortOrder : input.sortOrder,
      cleanOptional(input.description) === undefined
        ? unit.description
        : cleanOptional(input.description),
      input.status ?? unit.status,
      input.id,
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "organization_unit",
    resourceId: input.id,
    details: { operation: "organization_unit_updated" },
  });
  return true;
}

export async function assignOrganizationMember(
  user: User,
  input: { unitId: string; userId: number; title?: string; isPrimary?: boolean }
) {
  const [units] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id FROM organization_unit WHERE id=? AND status='active' LIMIT 1",
    [input.unitId]
  );
  if (!units[0]) throw new Error("组织单元不存在或已停用。");
  await assertActiveUser(input.userId, "组织成员");
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    if (input.isPrimary)
      await connection.query(
        "UPDATE organization_membership SET isPrimary=0,updatedAt=NOW() WHERE userId=?",
        [input.userId]
      );
    await connection.query(
      "INSERT INTO organization_membership (id,unitId,userId,title,isPrimary) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),isPrimary=VALUES(isPrimary),updatedAt=NOW()",
      [
        randomUUID(),
        input.unitId,
        input.userId,
        input.title?.trim() || null,
        Boolean(input.isPrimary),
      ]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    targetUserId: input.userId,
    action: "user_updated",
    resourceType: "organization_membership",
    resourceId: input.unitId + ":" + input.userId,
    details: {
      operation: "organization_member_assigned",
      isPrimary: Boolean(input.isPrimary),
    },
  });
  return true;
}

export async function removeOrganizationMember(
  user: User,
  input: { unitId: string; userId: number }
) {
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM organization_membership WHERE unitId=? AND userId=?",
    [input.unitId, input.userId]
  );
  if (!result.affectedRows) throw new Error("组织成员关系不存在。");
  await recordAuthorizationAudit({
    actorUserId: user.id,
    targetUserId: input.userId,
    action: "user_updated",
    resourceType: "organization_membership",
    resourceId: input.unitId + ":" + input.userId,
    details: { operation: "organization_member_removed" },
  });
  return true;
}

export async function setPrimaryOrganizationMembership(
  user: User,
  input: { unitId: string; userId: number }
) {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [memberships] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT om.id FROM organization_membership om JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active' WHERE om.unitId=? AND om.userId=? LIMIT 1 FOR UPDATE",
      [input.unitId, input.userId]
    );
    if (!memberships[0]) throw new Error("组织成员关系不存在或部门已停用。");
    await connection.query(
      "UPDATE organization_membership SET isPrimary=0,updatedAt=NOW() WHERE userId=?",
      [input.userId]
    );
    await connection.query(
      "UPDATE organization_membership SET isPrimary=1,updatedAt=NOW() WHERE unitId=? AND userId=?",
      [input.unitId, input.userId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    targetUserId: input.userId,
    action: "user_updated",
    resourceType: "organization_membership",
    resourceId: input.unitId + ":" + input.userId,
    details: { operation: "organization_primary_membership_set" },
  });
  return true;
}

export async function moveOrganizationMember(
  user: User,
  input: {
    fromUnitId: string;
    toUnitId: string;
    userId: number;
    title?: string;
    makePrimary?: boolean;
  }
) {
  if (input.fromUnitId === input.toUnitId)
    throw new Error("目标部门不能与当前部门相同。");
  const connection = await db().getConnection();
  let makePrimary = false;
  try {
    await connection.beginTransaction();
    const [targets] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM organization_unit WHERE id=? AND status='active' LIMIT 1 FOR UPDATE",
      [input.toUnitId]
    );
    if (!targets[0]) throw new Error("目标部门不存在或已停用。");
    const [sources] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,title,isPrimary FROM organization_membership WHERE unitId=? AND userId=? LIMIT 1 FOR UPDATE",
      [input.fromUnitId, input.userId]
    );
    const source = sources[0];
    if (!source) throw new Error("待迁移的组织成员关系不存在。");
    makePrimary = input.makePrimary ?? Boolean(source.isPrimary);
    if (makePrimary)
      await connection.query(
        "UPDATE organization_membership SET isPrimary=0,updatedAt=NOW() WHERE userId=?",
        [input.userId]
      );
    await connection.query(
      "INSERT INTO organization_membership (id,unitId,userId,title,isPrimary) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),isPrimary=VALUES(isPrimary),updatedAt=NOW()",
      [
        randomUUID(),
        input.toUnitId,
        input.userId,
        input.title === undefined ? source.title : input.title.trim() || null,
        makePrimary,
      ]
    );
    await connection.query(
      "DELETE FROM organization_membership WHERE unitId=? AND userId=?",
      [input.fromUnitId, input.userId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    targetUserId: input.userId,
    action: "user_updated",
    resourceType: "organization_membership",
    resourceId: input.fromUnitId + ":" + input.userId,
    details: {
      operation: "organization_member_moved",
      fromUnitId: input.fromUnitId,
      toUnitId: input.toUnitId,
      isPrimary: makePrimary,
    },
  });
  return true;
}

export async function deleteOrganizationUnit(
  user: User,
  input: { id: string }
) {
  const connection = await db().getConnection();
  let unit: mysql.RowDataPacket | undefined;
  try {
    await connection.beginTransaction();
    const [units] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,code,name FROM organization_unit WHERE id=? LIMIT 1 FOR UPDATE",
      [input.id]
    );
    unit = units[0];
    if (!unit) throw new Error("组织单元不存在。");
    const [childCount] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM organization_unit WHERE parentUnitId=?",
      [input.id]
    );
    const [memberCount] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM organization_membership WHERE unitId=?",
      [input.id]
    );
    const [roleCount] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM organization_unit_role WHERE unitId=?",
      [input.id]
    );
    const blockers = [
      Number(childCount[0]?.total) > 0
        ? `子部门 ${childCount[0].total} 个`
        : "",
      Number(memberCount[0]?.total) > 0
        ? `成员 ${memberCount[0].total} 人`
        : "",
      Number(roleCount[0]?.total) > 0 ? `权限组 ${roleCount[0].total} 个` : "",
    ].filter(Boolean);
    if (blockers.length)
      throw new Error(`无法删除部门：请先处理${blockers.join("、")}。`);
    await connection.query("DELETE FROM organization_unit WHERE id=?", [
      input.id,
    ]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === "ER_ROW_IS_REFERENCED_2")
      throw new Error(
        "无法删除部门：仍存在关联数据，请刷新后先完成迁移或解绑。"
      );
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "organization_unit",
    resourceId: input.id,
    details: {
      operation: "organization_unit_deleted",
      code: String(unit?.code || ""),
    },
  });
  return true;
}

export async function bindOrganizationRole(
  user: User,
  input: {
    unitId: string;
    roleId: number;
    includeDescendants?: boolean;
    effectiveFrom?: Date;
    expiresAt?: Date | null;
  }
) {
  const [units] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id FROM organization_unit WHERE id=? AND status='active' LIMIT 1",
    [input.unitId]
  );
  if (!units[0]) throw new Error("组织单元不存在或已停用。");
  const [roles] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,code,scope FROM iam_role WHERE id=? LIMIT 1",
    [input.roleId]
  );
  const role = roles[0];
  if (!role || role.scope !== "system" || role.code === "system_admin")
    throw new Error("仅可绑定系统范围且非系统管理员的权限组。");
  const effectiveFrom = input.effectiveFrom ?? new Date();
  if (input.expiresAt && input.expiresAt <= effectiveFrom)
    throw new Error("部门权限绑定到期时间必须晚于生效时间。");
  await db().query(
    "INSERT INTO organization_unit_role (id,unitId,roleId,includeDescendants,effectiveFrom,expiresAt,createdByUserId) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE includeDescendants=VALUES(includeDescendants),effectiveFrom=VALUES(effectiveFrom),expiresAt=VALUES(expiresAt),createdByUserId=VALUES(createdByUserId)",
    [
      randomUUID(),
      input.unitId,
      input.roleId,
      input.includeDescendants ?? true,
      effectiveFrom,
      input.expiresAt ?? null,
      user.id,
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "role_assigned",
    resourceType: "organization_unit",
    resourceId: input.unitId,
    details: {
      operation: "organization_role_bound",
      roleId: input.roleId,
      roleCode: role.code,
      includeDescendants: input.includeDescendants ?? true,
      effectiveFrom,
      expiresAt: input.expiresAt ?? null,
    },
  });
  return true;
}

export async function unbindOrganizationRole(
  user: User,
  input: { unitId: string; roleId: number }
) {
  const [result] = await db().query<mysql.ResultSetHeader>(
    "DELETE FROM organization_unit_role WHERE unitId=? AND roleId=?",
    [input.unitId, input.roleId]
  );
  if (!result.affectedRows) throw new Error("部门权限组绑定不存在。");
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "role_revoked",
    resourceType: "organization_unit",
    resourceId: input.unitId,
    details: { operation: "organization_role_unbound", roleId: input.roleId },
  });
  return true;
}

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
  for (const candidate of candidates)
    await assertActiveUser(candidate, "操作候选人");
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
    excluded: [],
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
