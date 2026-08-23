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

const asRecord = (value: unknown): JsonRecord => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {});
const asStrings = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);

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

const cleanOptional = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);

export async function listOrganization() {
  const [units] = await db().query<mysql.RowDataPacket[]>(
    "SELECT ou.*,manager.name AS managerName,manager.username AS managerUsername,parent.name AS parentName FROM organization_unit ou LEFT JOIN users manager ON manager.id=ou.managerUserId LEFT JOIN organization_unit parent ON parent.id=ou.parentUnitId ORDER BY ou.status,ou.sortOrder,ou.code"
  );
  const [members] = await db().query<mysql.RowDataPacket[]>(
    "SELECT om.*,u.name,u.username,u.status AS userStatus,ou.name AS unitName FROM organization_membership om JOIN users u ON u.id=om.userId JOIN organization_unit ou ON ou.id=om.unitId ORDER BY ou.code,om.isPrimary DESC,u.name,u.username"
  );
  const [roleBindings] = await db().query<mysql.RowDataPacket[]>(
    "SELECT our.id,our.unitId,our.roleId,our.createdByUserId,our.createdAt,r.code AS roleCode,r.name AS roleName,r.description AS roleDescription,r.scope FROM organization_unit_role our JOIN iam_role r ON r.id=our.roleId ORDER BY r.name,r.code"
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
    `SELECT DISTINCT om.userId,our.unitId,ou.name AS unitName,our.roleId,
            r.code AS roleCode,r.name AS roleName
       FROM organization_membership om
       JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
       JOIN organization_unit_role our ON our.unitId=ou.id
       JOIN iam_role r ON r.id=our.roleId
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
  return {
    units,
    members: members.map(member => ({
      ...member,
      directRoles: directRolesByUser.get(Number(member.userId)) ?? [],
      inheritedRoles: inheritedRolesByUser.get(Number(member.userId)) ?? [],
    })),
    roleBindings,
  };
}

export async function createOrganizationUnit(user: User, input: { code: string; name: string } & Omit<OrganizationUnitFields, "name" | "status">) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(code)) throw new Error("组织单元代号须以字母开头，且仅包含大写字母、数字、下划线或连字符。");
  let parentLevel: number | null = null;
  if (input.parentUnitId) {
    const [parents] = await db().query<mysql.RowDataPacket[]>("SELECT id,unitLevel FROM organization_unit WHERE id=? AND status='active' LIMIT 1", [input.parentUnitId]);
    if (!parents[0]) throw new Error("上级组织单元不存在或已停用。");
    parentLevel = parents[0].unitLevel === null ? null : Number(parents[0].unitLevel);
  }
  if (input.managerUserId) await assertActiveUser(input.managerUserId, "负责人");
  const id = randomUUID();
  const unitLevel = input.unitLevel ?? (parentLevel === null ? (input.parentUnitId ? 2 : 1) : parentLevel + 1);
  await db().query("INSERT INTO organization_unit (id,code,name,parentUnitId,managerUserId,unitType,unitLevel,standardCode,areaCode,category,sortOrder,description,createdByUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [id, code, input.name.trim(), input.parentUnitId ?? null, input.managerUserId ?? null, cleanOptional(input.unitType) ?? null, unitLevel, cleanOptional(input.standardCode) ?? null, cleanOptional(input.areaCode) ?? null, cleanOptional(input.category) ?? null, input.sortOrder ?? 0, cleanOptional(input.description) ?? null, user.id]);
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "organization_unit",
    resourceId: id,
    details: { operation: "organization_unit_created", code },
  });
  return id;
}

export async function updateOrganizationUnit(user: User, input: { id: string } & OrganizationUnitFields) {
  const [rows] = await db().query<mysql.RowDataPacket[]>("SELECT * FROM organization_unit WHERE id=? LIMIT 1", [input.id]);
  const unit = rows[0];
  if (!unit) throw new Error("组织单元不存在。");
  if (input.parentUnitId === input.id) throw new Error("组织单元不能把自身设为上级。");
  if (input.parentUnitId) {
    const [parents] = await db().query<mysql.RowDataPacket[]>("SELECT id FROM organization_unit WHERE id=? AND status='active' LIMIT 1", [input.parentUnitId]);
    if (!parents[0]) throw new Error("上级组织单元不存在或已停用。");
    let cursor: string | null = input.parentUnitId;
    for (let depth = 0; cursor && depth < 32; depth += 1) {
      if (cursor === input.id) throw new Error("组织单元层级不能形成循环。");
      const ancestorResult = await db().query<mysql.RowDataPacket[]>("SELECT parentUnitId FROM organization_unit WHERE id=? LIMIT 1", [cursor]);
      const ancestorRows: mysql.RowDataPacket[] = ancestorResult[0];
      cursor = ancestorRows[0]?.parentUnitId ? String(ancestorRows[0].parentUnitId) : null;
    }
  }
  if (input.managerUserId) await assertActiveUser(input.managerUserId, "负责人");
  await db().query("UPDATE organization_unit SET name=?,parentUnitId=?,managerUserId=?,unitType=?,unitLevel=?,standardCode=?,areaCode=?,category=?,sortOrder=?,description=?,status=?,updatedAt=NOW() WHERE id=?", [input.name?.trim() || unit.name, input.parentUnitId === undefined ? unit.parentUnitId : input.parentUnitId, input.managerUserId === undefined ? unit.managerUserId : input.managerUserId, cleanOptional(input.unitType) === undefined ? unit.unitType : cleanOptional(input.unitType), input.unitLevel === undefined ? unit.unitLevel : input.unitLevel, cleanOptional(input.standardCode) === undefined ? unit.standardCode : cleanOptional(input.standardCode), cleanOptional(input.areaCode) === undefined ? unit.areaCode : cleanOptional(input.areaCode), cleanOptional(input.category) === undefined ? unit.category : cleanOptional(input.category), input.sortOrder === undefined ? unit.sortOrder : input.sortOrder, cleanOptional(input.description) === undefined ? unit.description : cleanOptional(input.description), input.status ?? unit.status, input.id]);
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "organization_unit",
    resourceId: input.id,
    details: { operation: "organization_unit_updated" },
  });
  return true;
}

export async function assignOrganizationMember(user: User, input: { unitId: string; userId: number; title?: string; isPrimary?: boolean }) {
  const [units] = await db().query<mysql.RowDataPacket[]>("SELECT id FROM organization_unit WHERE id=? AND status='active' LIMIT 1", [input.unitId]);
  if (!units[0]) throw new Error("组织单元不存在或已停用。");
  await assertActiveUser(input.userId, "组织成员");
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    if (input.isPrimary) await connection.query("UPDATE organization_membership SET isPrimary=0,updatedAt=NOW() WHERE userId=?", [input.userId]);
    await connection.query("INSERT INTO organization_membership (id,unitId,userId,title,isPrimary) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),isPrimary=VALUES(isPrimary),updatedAt=NOW()", [randomUUID(), input.unitId, input.userId, input.title?.trim() || null, Boolean(input.isPrimary)]);
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

export async function removeOrganizationMember(user: User, input: { unitId: string; userId: number }) {
  const [result] = await db().query<mysql.ResultSetHeader>("DELETE FROM organization_membership WHERE unitId=? AND userId=?", [input.unitId, input.userId]);
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

export async function bindOrganizationRole(user: User, input: { unitId: string; roleId: number }) {
  const [units] = await db().query<mysql.RowDataPacket[]>("SELECT id FROM organization_unit WHERE id=? AND status='active' LIMIT 1", [input.unitId]);
  if (!units[0]) throw new Error("组织单元不存在或已停用。");
  const [roles] = await db().query<mysql.RowDataPacket[]>("SELECT id,code,scope FROM iam_role WHERE id=? LIMIT 1", [input.roleId]);
  const role = roles[0];
  if (!role || role.scope !== "system" || role.code === "system_admin") throw new Error("仅可绑定系统范围且非系统管理员的权限组。");
  await db().query("INSERT IGNORE INTO organization_unit_role (id,unitId,roleId,createdByUserId) VALUES (?,?,?,?)", [randomUUID(), input.unitId, input.roleId, user.id]);
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "role_assigned",
    resourceType: "organization_unit",
    resourceId: input.unitId,
    details: {
      operation: "organization_role_bound",
      roleId: input.roleId,
      roleCode: role.code,
    },
  });
  return true;
}

export async function unbindOrganizationRole(user: User, input: { unitId: string; roleId: number }) {
  const [result] = await db().query<mysql.ResultSetHeader>("DELETE FROM organization_unit_role WHERE unitId=? AND roleId=?", [input.unitId, input.roleId]);
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
  const [users] = await db().query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id=? AND status='active' LIMIT 1", [userId]);
  if (!users[0]) throw new Error(label + "不存在或已停用。");
}

export async function resolveDirectManagerUserId(userId: number) {
  const [memberships] = await db().query<mysql.RowDataPacket[]>("SELECT om.unitId,ou.managerUserId,ou.parentUnitId FROM organization_membership om JOIN organization_unit ou ON ou.id=om.unitId WHERE om.userId=? AND ou.status='active' ORDER BY om.isPrimary DESC,om.createdAt LIMIT 1", [userId]);
  let unit = memberships[0];
  if (!unit) return null;
  for (let depth = 0; unit && depth < 32; depth += 1) {
    const managerUserId = Number(unit.managerUserId);
    if (Number.isInteger(managerUserId) && managerUserId > 0 && managerUserId !== userId) {
      const [managers] = await db().query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE id=? AND status='active' LIMIT 1", [managerUserId]);
      if (managers[0]) return managerUserId;
    }
    if (!unit.parentUnitId) return null;
    const [parents] = await db().query<mysql.RowDataPacket[]>("SELECT id AS unitId,managerUserId,parentUnitId FROM organization_unit WHERE id=? AND status='active' LIMIT 1", [unit.parentUnitId]);
    unit = parents[0];
  }
  return null;
}

export async function resolveRoleCandidateUserIds(roleCode: string, workflowId: string) {
  if (!roleCode.trim()) return [];
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN (
         SELECT ra.userId FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId
          WHERE r.code=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
            AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=?))
         UNION
         SELECT om.userId FROM organization_membership om
           JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
           JOIN organization_unit_role our ON our.unitId=ou.id
           JOIN iam_role r ON r.id=our.roleId
          WHERE r.code=?
       ) eligible ON eligible.userId=u.id
      WHERE u.status='active' ORDER BY u.id`,
    [roleCode.trim(), workflowId, roleCode.trim()]
  );
  return rows.map(row => Number(row.id)).filter(id => Number.isInteger(id) && id > 0);
}

export async function resolveWorkflowUserRoleKeys(userIds: number[], workflowId: string) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(id => Number.isInteger(id) && id > 0)));
  const result = new Map<number, string[]>(uniqueUserIds.map(userId => [userId, ["default"]]));
  if (!uniqueUserIds.length) return result;
  const placeholders = uniqueUserIds.map(() => "?").join(",");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT eligible.userId,r.id AS roleId,r.code
       FROM (
         SELECT ra.userId,ra.roleId FROM role_assignment ra
          WHERE ra.userId IN (${placeholders}) AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW() AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())
            AND (ra.scopeType='system' OR (ra.scopeType='workflow' AND ra.scopeId=?))
         UNION
         SELECT om.userId,our.roleId FROM organization_membership om
           JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
           JOIN organization_unit_role our ON our.unitId=ou.id
          WHERE om.userId IN (${placeholders})
       ) eligible JOIN iam_role r ON r.id=eligible.roleId JOIN users u ON u.id=eligible.userId AND u.status='active'`,
    [...uniqueUserIds, workflowId, ...uniqueUserIds]
  );
  for (const row of rows) {
    const userId = Number(row.userId);
    const roleCode = String(row.code || "").trim();
    if (result.has(userId) && roleCode) result.set(userId, Array.from(new Set([...(result.get(userId) ?? []), roleCode, String(row.roleId)])));
  }
  return result;
}

export async function resolveOperateAssignees(input: { config: JsonRecord; context: JsonRecord; workflowId: string }) {
  const runtime = asRecord(input.context.runtime);
  const initiatorUserId = Number(runtime.triggeredByUserId);
  const senderUserId = Number(runtime.lastActorUserId || runtime.triggeredByUserId);
  let mode = String(input.config.assigneeMode || "");
  const legacyText = JSON.stringify({
    qxkz: input.config.qxkz,
    bddx: input.config.bddx,
    sxsz: input.config.sxsz,
  });
  if (!mode && /direct_manager|直属上级|upperAuthUnitWord/.test(legacyText)) mode = "initiator_manager";
  if (!mode) mode = input.config.assigneeUserId ? "user" : "receivers";

  let candidates: number[] = [];
  if (mode === "receivers") candidates = Array.isArray(runtime.receiverUserIds) ? runtime.receiverUserIds.map(Number) : [];
  else if (mode === "user") candidates = [Number(input.config.assigneeUserId)];
  else if (mode === "initiator") candidates = [initiatorUserId];
  else if (mode === "initiator_manager") candidates = [Number(await resolveDirectManagerUserId(initiatorUserId))];
  else if (mode === "sender_manager") candidates = [Number(await resolveDirectManagerUserId(senderUserId))];
  else if (mode === "role") candidates = await resolveRoleCandidateUserIds(String(input.config.assigneeRoleCode || ""), input.workflowId);

  candidates = Array.from(new Set(candidates.filter(id => Number.isInteger(id) && id > 0)));
  if (mode !== "none" && candidates.length === 0) throw new Error("操作节点未解析到有效处理人，请检查上一步接收方、组织负责人或角色授权配置。");
  for (const candidate of candidates) await assertActiveUser(candidate, "操作候选人");
  return {
    mode,
    assignedUserId: candidates.length === 1 ? candidates[0] : null,
    candidateUserIds: candidates,
  };
}

export async function resolveAutoRelatedParticipantUserIds(config: JsonRecord, context: JsonRecord) {
  const autoRelatedParty = normalizeReferenceOperateConfig(config).autoRelatedParty;
  if (!autoRelatedParty.includes("upperAuthUnitWord")) return [];
  const runtime = asRecord(context.runtime);
  const sources = [Number(runtime.lastActorUserId || runtime.triggeredByUserId)].filter(id => Number.isInteger(id) && id > 0);
  const managers = await Promise.all(Array.from(new Set(sources)).map(resolveDirectManagerUserId));
  return Array.from(new Set(managers.filter((id): id is number => Number.isInteger(id) && Number(id) > 0)));
}
