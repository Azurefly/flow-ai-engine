import {
  organizationUnitToken,
  organizationMembershipToken,
  organizationBindingToken,
  assertOrganizationToken,
} from "./organization-configuration";
import { assertCustomRoleConfigToken } from "./custom-role-configuration";
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  ensureIamCatalog,
  hasSystemPermission,
  recordAuthorizationAudit,
} from "./iam-service";
import type { OrganizationUnitFields } from "./organization-service";

type Actor = { id: number; role: "user" | "admin"; tokenVersion?: number };
type Context = {
  connection: mysql.PoolConnection;
  accounts: mysql.RowDataPacket[];
  recheck: () => Promise<void>;
};
const treeLock = "flow_ai_organization_tree_update";
const reject = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
const optional = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

/** One lock order for all organization writes, including creation/deletion.
 * Resolve authorization only after waiting, and keep the audit in this transaction.
 */
async function changeOrganization<T>(
  actor: Actor,
  accountIds: Array<number | null | undefined>,
  write: (context: Context) => Promise<T>
): Promise<T> {
  await ensureIamCatalog();
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await getSharedPool().getConnection();
    let acquired = false;
    let reusable = false;
    try {
      const [locks] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT GET_LOCK(?, 5) AS acquired",
        [treeLock]
      );
      reusable = true;
      acquired = Number(locks[0]?.acquired) === 1;
      if (!acquired)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "其他管理员正在修改组织配置，本次修改未提交；请保留填写并稍后重试。",
        });
      await connection.beginTransaction();
      const ids = Array.from(
        new Set(
          [actor.id, ...accountIds].filter((id): id is number => Boolean(id))
        )
      ).sort((a, b) => a - b);
      const [accounts] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,role,status,tokenVersion FROM users WHERE id IN (?) ORDER BY id FOR UPDATE",
        [ids]
      );
      const current = accounts.find(row => Number(row.id) === actor.id);
      if (
        !current ||
        current.status !== "active" ||
        !["admin", "user"].includes(current.role) ||
        (actor.tokenVersion !== undefined &&
          Number(current.tokenVersion) !== actor.tokenVersion)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "登录状态已变化，本次组织修改未提交；请保留填写并重新登录。",
        });
      const recheck = async () => {
        if (
          !(await hasSystemPermission(
            { id: Number(current.id), role: current.role },
            "iam:manage",
            connection
          ))
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "组织管理权限已变化，本次修改未提交；请保留填写并重新核对权限。",
          });
      };
      await recheck();
      const result = await write({ connection, accounts, recheck });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {
        reusable = false;
      });
      const failure = error as { code?: string; errno?: number };
      if (failure?.code === "ER_LOCK_DEADLOCK" || failure?.errno === 1213) {
        if (attempt === 2)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "组织配置正在被同时修改，本次修改未提交；请保留填写并稍后重试。",
            cause: error,
          });
      } else if (error instanceof TRPCError) throw error;
      else if (failure?.code === "ER_ROW_IS_REFERENCED_2")
        reject("无法删除部门：仍存在关联数据，请刷新后先完成迁移或解绑。");
      else
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "暂时无法确认组织保存结果，请保留填写并重新读取列表核对。",
          cause: error,
        });
    } finally {
      if (acquired) {
        try {
          const [released] = await connection.query<mysql.RowDataPacket[]>(
            "SELECT RELEASE_LOCK(?) AS released",
            [treeLock]
          );
          if (Number(released[0]?.released) !== 1) reusable = false;
        } catch {
          reusable = false;
        }
      }
      if (reusable) connection.release();
      else connection.destroy();
    }
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error("组织配置未提交。");
}

async function unit(
  connection: mysql.PoolConnection,
  id: string,
  active = false
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT * FROM organization_unit WHERE id=? LIMIT 1 FOR UPDATE",
    [id]
  );
  const row = rows[0];
  if (!row || (active && row.status !== "active"))
    reject(active ? "组织单元不存在或已停用。" : "组织单元不存在。");
  return row;
}
function account(
  accounts: mysql.RowDataPacket[],
  id: number,
  label: string,
  active = false
) {
  const row = accounts.find(item => Number(item.id) === id);
  if (!row || (active && row.status !== "active"))
    reject(label + (active ? "不存在或已停用。" : "账号不存在。"));
}
async function audit(
  context: Context,
  actor: Actor,
  resourceType: "organization_unit" | "organization_membership",
  resourceId: string,
  details: Record<string, unknown>,
  targetUserId?: number,
  action: "user_updated" | "role_assigned" | "role_revoked" = "user_updated"
) {
  await recordAuthorizationAudit(
    {
      actorUserId: actor.id,
      targetUserId,
      action,
      resourceType,
      resourceId,
      details,
    },
    context.connection
  );
}
async function membership(
  connection: mysql.PoolConnection,
  unitId: string,
  userId: number
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id,title,isPrimary FROM organization_membership WHERE unitId=? AND userId=? LIMIT 1 FOR UPDATE",
    [unitId, userId]
  );
  if (!rows[0]) reject("组织成员关系不存在，请重新读取列表核对。");
  return rows[0];
}

export async function createOrganizationUnit(
  actor: Actor,
  input: { code: string; name: string } & Omit<
    OrganizationUnitFields,
    "name" | "status"
  >
) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(code))
    reject(
      "组织单元代号须以字母开头，且仅包含大写字母、数字、下划线或连字符。"
    );
  return changeOrganization(actor, [input.managerUserId], async context => {
    const { connection, accounts, recheck } = context;
    const parent = input.parentUnitId
      ? await unit(connection, input.parentUnitId, true)
      : null;
    if (input.managerUserId)
      account(accounts, input.managerUserId, "负责人", true);
    const level =
      input.unitLevel ?? (parent ? Number(parent.unitLevel ?? 1) + 1 : 1);
    if (level > 99) reject("部门层级不能超过99层，请调整上级部门或层级。");
    const id = randomUUID();
    await recheck();
    try {
      await connection.query(
        "INSERT INTO organization_unit (id,code,name,parentUnitId,managerUserId,unitType,unitLevel,standardCode,areaCode,category,sortOrder,description,createdByUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          code,
          input.name.trim(),
          input.parentUnitId ?? null,
          input.managerUserId ?? null,
          optional(input.unitType) ?? null,
          level,
          optional(input.standardCode) ?? null,
          optional(input.areaCode) ?? null,
          optional(input.category) ?? null,
          input.sortOrder ?? 0,
          optional(input.description) ?? null,
          actor.id,
        ]
      );
    } catch (error) {
      const failure = error as {
        code?: string;
        errno?: number;
        message?: string;
        sqlMessage?: string;
      };
      if (
        (failure.code === "ER_DUP_ENTRY" || failure.errno === 1062) &&
        String(failure.message ?? failure.sqlMessage ?? "").includes(
          "organization_unit_code_unique"
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "部门编码已存在，请使用其他编码；如需修改已有部门，请在部门列表中选择后编辑。",
        });
      throw error;
    }
    await audit(context, actor, "organization_unit", id, {
      operation: "organization_unit_created",
      code,
    });
    return id;
  });
}

export async function updateOrganizationUnit(
  actor: Actor,
  input: { id: string; expectedConfigToken?: string } & OrganizationUnitFields
) {
  return changeOrganization(actor, [input.managerUserId], async context => {
    const { connection, accounts, recheck } = context;
    const current = await unit(connection, input.id);
    assertOrganizationToken(
      input.expectedConfigToken,
      organizationUnitToken(current),
      "部门配置"
    );
    if (input.parentUnitId === input.id) reject("组织单元不能把自身设为上级。");
    if (input.parentUnitId) {
      await unit(connection, input.parentUnitId, true);
      let cursor: string | null = input.parentUnitId;
      const visited = new Set<string>();
      for (let depth = 0; cursor && depth < 32; depth++) {
        if (cursor === input.id) reject("组织单元层级不能形成循环。");
        if (visited.has(cursor))
          reject("上级部门的组织层级存在循环，请先修复层级后重试。");
        visited.add(cursor);
        const [ancestors]: [mysql.RowDataPacket[], unknown] =
          await connection.query<mysql.RowDataPacket[]>(
            "SELECT parentUnitId FROM organization_unit WHERE id=? LIMIT 1 FOR UPDATE",
            [cursor]
          );
        cursor = ancestors[0]?.parentUnitId
          ? String(ancestors[0].parentUnitId)
          : null;
      }
      if (cursor)
        reject("上级部门层级超过32层，无法完成循环检查，请调整层级后重试。");
    }
    if (input.managerUserId)
      account(accounts, input.managerUserId, "负责人", true);
    await recheck();
    await connection.query(
      "UPDATE organization_unit SET name=?,parentUnitId=?,managerUserId=?,unitType=?,unitLevel=?,standardCode=?,areaCode=?,category=?,sortOrder=?,description=?,status=?,updatedAt=NOW() WHERE id=?",
      [
        input.name?.trim() || current.name,
        input.parentUnitId === undefined
          ? current.parentUnitId
          : input.parentUnitId,
        input.managerUserId === undefined
          ? current.managerUserId
          : input.managerUserId,
        optional(input.unitType) === undefined
          ? current.unitType
          : optional(input.unitType),
        input.unitLevel === undefined ? current.unitLevel : input.unitLevel,
        optional(input.standardCode) === undefined
          ? current.standardCode
          : optional(input.standardCode),
        optional(input.areaCode) === undefined
          ? current.areaCode
          : optional(input.areaCode),
        optional(input.category) === undefined
          ? current.category
          : optional(input.category),
        input.sortOrder === undefined ? current.sortOrder : input.sortOrder,
        optional(input.description) === undefined
          ? current.description
          : optional(input.description),
        input.status ?? current.status,
        input.id,
      ]
    );
    await audit(context, actor, "organization_unit", input.id, {
      operation: "organization_unit_updated",
    });
    return true;
  });
}

async function assertMembershipSnapshot(
  context: Context,
  input: {
    userId: number;
    unitId?: string;
    expectedMembershipToken?: string;
    onlyIfAbsent?: boolean;
  }
) {
  if (!input.expectedMembershipToken && !input.onlyIfAbsent) return;
  const [rows] = await context.connection.query<mysql.RowDataPacket[]>(
    "SELECT id,unitId,userId,title,isPrimary FROM organization_membership WHERE userId=? ORDER BY id FOR UPDATE",
    [input.userId]
  );
  assertOrganizationToken(
    input.expectedMembershipToken,
    organizationMembershipToken(input.userId, rows),
    "成员归属"
  );
  if (input.onlyIfAbsent && rows.some(row => row.unitId === input.unitId))
    throw new TRPCError({
      code: "CONFLICT",
      message: "该账号已加入此部门，请先读取成员列表核对，不会覆盖现有岗位。",
    });
}

export async function assignOrganizationMember(
  actor: Actor,
  input: { unitId: string; userId: number; title?: string; isPrimary?: boolean; expectedMembershipToken?: string; onlyIfAbsent?: boolean }
) {
  return changeOrganization(actor, [input.userId], async context => {
    const { connection, accounts, recheck } = context;
    account(accounts, input.userId, "组织成员", true);
    await assertMembershipSnapshot(context, input);
    await unit(connection, input.unitId, true);
    await recheck();
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
    await audit(
      context,
      actor,
      "organization_membership",
      input.unitId + ":" + input.userId,
      {
        operation: "organization_member_assigned",
        isPrimary: Boolean(input.isPrimary),
      },
      input.userId
    );
    return true;
  });
}
export async function removeOrganizationMember(
  actor: Actor,
  input: { unitId: string; userId: number; expectedMembershipToken?: string }
) {
  return changeOrganization(actor, [input.userId], async context => {
    account(context.accounts, input.userId, "组织成员");
    await assertMembershipSnapshot(context, input);
    await unit(context.connection, input.unitId);
    await membership(context.connection, input.unitId, input.userId);
    await context.recheck();
    await context.connection.query(
      "DELETE FROM organization_membership WHERE unitId=? AND userId=?",
      [input.unitId, input.userId]
    );
    await audit(
      context,
      actor,
      "organization_membership",
      input.unitId + ":" + input.userId,
      { operation: "organization_member_removed" },
      input.userId
    );
    return true;
  });
}
export async function setPrimaryOrganizationMembership(
  actor: Actor,
  input: { unitId: string; userId: number; expectedMembershipToken?: string }
) {
  return changeOrganization(actor, [input.userId], async context => {
    const { connection, accounts, recheck } = context;
    account(accounts, input.userId, "组织成员");
    await assertMembershipSnapshot(context, input);
    await unit(connection, input.unitId, true);
    await membership(connection, input.unitId, input.userId);
    await recheck();
    await connection.query(
      "UPDATE organization_membership SET isPrimary=0,updatedAt=NOW() WHERE userId=?",
      [input.userId]
    );
    await connection.query(
      "UPDATE organization_membership SET isPrimary=1,updatedAt=NOW() WHERE unitId=? AND userId=?",
      [input.unitId, input.userId]
    );
    await audit(
      context,
      actor,
      "organization_membership",
      input.unitId + ":" + input.userId,
      { operation: "organization_primary_membership_set" },
      input.userId
    );
    return true;
  });
}
export async function moveOrganizationMember(
  actor: Actor,
  input: {
    fromUnitId: string;
    toUnitId: string;
    userId: number;
    title?: string;
    makePrimary?: boolean;
    expectedMembershipToken?: string;
  }
) {
  if (input.fromUnitId === input.toUnitId)
    reject("目标部门不能与当前部门相同。");
  return changeOrganization(actor, [input.userId], async context => {
    const { connection, accounts, recheck } = context;
    account(accounts, input.userId, "组织成员");
    await assertMembershipSnapshot(context, input);
    await unit(connection, input.toUnitId, true);
    await unit(connection, input.fromUnitId);
    const source = await membership(connection, input.fromUnitId, input.userId);
    const makePrimary = input.makePrimary ?? Boolean(source.isPrimary);
    await recheck();
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
    await audit(
      context,
      actor,
      "organization_membership",
      input.fromUnitId + ":" + input.userId,
      {
        operation: "organization_member_moved",
        fromUnitId: input.fromUnitId,
        toUnitId: input.toUnitId,
        isPrimary: makePrimary,
      },
      input.userId
    );
    return true;
  });
}
export async function deleteOrganizationUnit(
  actor: Actor,
  input: { id: string; expectedConfigToken?: string }
) {
  return changeOrganization(actor, [], async context => {
    const { connection, recheck } = context;
    const current = await unit(connection, input.id);
    assertOrganizationToken(
      input.expectedConfigToken,
      organizationUnitToken(current),
      "部门配置"
    );
    const blockers: string[] = [];
    for (const [table, column, label, suffix] of [
      ["organization_unit", "parentUnitId", "子部门", "个"],
      ["organization_membership", "unitId", "成员", "人"],
      ["organization_unit_role", "unitId", "权限组", "个"],
    ]) {
      // These names are fixed above, never supplied by a request.
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id FROM ${table} WHERE ${column}=? FOR UPDATE`,
        [input.id]
      );
      if (rows.length) blockers.push(`${label} ${rows.length} ${suffix}`);
    }
    if (blockers.length)
      reject(`无法删除部门：请先处理${blockers.join("、")}。`);
    await recheck();
    await connection.query("DELETE FROM organization_unit WHERE id=?", [
      input.id,
    ]);
    await audit(context, actor, "organization_unit", input.id, {
      operation: "organization_unit_deleted",
      code: String(current.code),
    });
    return true;
  });
}
export async function bindOrganizationRole(
  actor: Actor,
  input: {
    unitId: string;
    roleId: number;
    includeDescendants?: boolean;
    effectiveFrom?: Date;
    expiresAt?: Date | null;
    expectedRoleConfigToken?: string;
    onlyIfAbsent?: boolean;
  }
) {
  return changeOrganization(actor, [], async context => {
    const { connection, recheck } = context;
    await unit(connection, input.unitId, true);
    const [roles] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,code,name,description,scope,isSystem FROM iam_role WHERE id=? LIMIT 1 FOR UPDATE",
      [input.roleId]
    );
    const role = roles[0];
    if (!role || role.scope !== "system" || role.code === "system_admin")
      reject("仅可绑定系统范围且非系统管理员的权限组。");
    if (input.expectedRoleConfigToken) {
      const [links] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT permissionId FROM role_permission WHERE roleId=? ORDER BY permissionId FOR SHARE",
        [input.roleId]
      );
      const [permissions] = links.length
        ? await connection.query<mysql.RowDataPacket[]>(
            "SELECT code FROM permission WHERE id IN (?) ORDER BY code FOR SHARE",
            [links.map(row => row.permissionId)]
          )
        : [[]];
      assertCustomRoleConfigToken(input.expectedRoleConfigToken, {
        ...role,
        permissions: permissions.map(row => row.code),
      });
    }
    if (input.onlyIfAbsent) {
      const [existing] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id FROM organization_unit_role WHERE unitId=? AND roleId=? FOR UPDATE",
        [input.unitId, input.roleId]
      );
      if (existing.length)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "此部门已绑定该权限组，请先读取列表核对，不会覆盖现有范围和有效期。",
        });
    }
    const effectiveFrom = input.effectiveFrom ?? new Date();
    if (input.expiresAt && input.expiresAt <= effectiveFrom)
      reject("部门权限绑定到期时间必须晚于生效时间。");
    await recheck();
    await connection.query(
      "INSERT INTO organization_unit_role (id,unitId,roleId,includeDescendants,effectiveFrom,expiresAt,createdByUserId) VALUES (?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?) ON DUPLICATE KEY UPDATE includeDescendants=VALUES(includeDescendants),effectiveFrom=VALUES(effectiveFrom),expiresAt=VALUES(expiresAt),createdByUserId=VALUES(createdByUserId)",
      [
        randomUUID(),
        input.unitId,
        input.roleId,
        input.includeDescendants ?? true,
        input.effectiveFrom ?? null,
        input.expiresAt ?? null,
        actor.id,
      ]
    );
    await audit(
      context,
      actor,
      "organization_unit",
      input.unitId,
      {
        operation: "organization_role_bound",
        roleId: input.roleId,
        roleCode: role.code,
        includeDescendants: input.includeDescendants ?? true,
        effectiveFrom,
        expiresAt: input.expiresAt ?? null,
      },
      undefined,
      "role_assigned"
    );
    return true;
  });
}
export async function unbindOrganizationRole(
  actor: Actor,
  input: { unitId: string; roleId: number; expectedConfigToken?: string }
) {
  return changeOrganization(actor, [], async context => {
    await unit(context.connection, input.unitId);
    const [rows] = await context.connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM organization_unit_role WHERE unitId=? AND roleId=? FOR UPDATE",
      [input.unitId, input.roleId]
    );
    if (!rows[0]) reject("部门权限组绑定不存在。");
    assertOrganizationToken(
      input.expectedConfigToken,
      organizationBindingToken(rows[0]),
      "部门权限绑定"
    );
    await context.recheck();
    await context.connection.query(
      "DELETE FROM organization_unit_role WHERE unitId=? AND roleId=?",
      [input.unitId, input.roleId]
    );
    await audit(
      context,
      actor,
      "organization_unit",
      input.unitId,
      { operation: "organization_role_unbound", roleId: input.roleId },
      undefined,
      "role_revoked"
    );
    return true;
  });
}
