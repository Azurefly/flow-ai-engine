import mysql from "mysql2/promise";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import { ensureIamCatalog } from "./iam-service";

export const roleMemberPageInput = z.object({
  roleId: z.number().int().positive(),
  kind: z.enum(["direct", "sources", "inherited"]),
  unitId: z.string().uuid().optional(),
  search: z.string().trim().max(160).default(""),
  status: z.enum(["active", "disabled"]).optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
});

const directFrom = `FROM role_assignment ra JOIN users u ON u.id=ra.userId
  WHERE ra.roleId=? AND ra.revokedAt IS NULL AND ra.effectiveFrom<=NOW()
    AND (ra.expiresAt IS NULL OR ra.expiresAt>NOW())`;
// Traverse only this role's active source departments, instead of every membership.
const inheritedCte = `WITH RECURSIVE role_units AS (
  SELECT ou.id AS sourceUnitId,ou.id AS unitId,our.includeDescendants,0 AS depth
    FROM organization_unit_role our JOIN organization_unit ou ON ou.id=our.unitId AND ou.status='active'
   WHERE our.roleId=? AND our.effectiveFrom<=NOW() AND (our.expiresAt IS NULL OR our.expiresAt>NOW())
  UNION ALL
  SELECT ru.sourceUnitId,child.id,ru.includeDescendants,ru.depth+1
    FROM role_units ru JOIN organization_unit child ON child.parentUnitId=ru.unitId AND child.status='active'
   WHERE ru.includeDescendants=1 AND ru.depth<32
), inherited_members AS (
  SELECT DISTINCT om.userId,ru.sourceUnitId FROM role_units ru
    JOIN organization_membership om ON om.unitId=ru.unitId
)`;

export async function getRoleAuthorizationOverview(roleId: number) {
  await ensureIamCatalog();
  const db = getSharedPool();
  const [roles] = await db.query<mysql.RowDataPacket[]>(
    "SELECT id,code,name,description,scope,isSystem FROM iam_role WHERE id=?",
    [roleId]
  );
  if (!roles[0])
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到该角色。" });
  const [permissions] = await db.query<mysql.RowDataPacket[]>(
    "SELECT p.code,p.name,p.description FROM role_permission rp JOIN permission p ON p.id=rp.permissionId WHERE rp.roleId=? ORDER BY p.code",
    [roleId]
  );
  const [direct] = await db.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS records,COUNT(DISTINCT u.id) AS users ${directFrom}`,
    [roleId]
  );
  const [inherited] = await db.query<mysql.RowDataPacket[]>(
    `${inheritedCte} SELECT COUNT(*) AS records,COUNT(DISTINCT userId) AS users FROM inherited_members`,
    [roleId]
  );
  const [sources] = await db.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM organization_unit_role WHERE roleId=?",
    [roleId]
  );
  return {
    role: roles[0],
    permissions,
    direct: {
      users: Number(direct[0].users),
      records: Number(direct[0].records),
    },
    inherited: {
      users: Number(inherited[0].users),
      records: Number(inherited[0].records),
    },
    sources: Number(sources[0].total),
  };
}

export async function listRoleMembersPage(
  raw: z.input<typeof roleMemberPageInput>
) {
  const input = roleMemberPageInput.parse(raw);
  const db = getSharedPool();
  const params: unknown[] = [input.roleId];
  let cte = "",
    from = "",
    fields = "",
    order = "";
  if (input.kind === "direct") {
    from = directFrom;
    fields =
      "ra.id AS assignmentId,u.id AS userId,u.username,u.name,u.status,ra.scopeType,ra.scopeId,ra.expiresAt,ra.note";
    order = "u.name,u.username,u.id,ra.scopeType,ra.scopeId,ra.id";
  } else if (input.kind === "inherited") {
    cte = inheritedCte;
    from =
      "FROM inherited_members im JOIN users u ON u.id=im.userId JOIN organization_unit ou ON ou.id=im.sourceUnitId WHERE 1=1";
    if (input.unitId) {
      from += " AND im.sourceUnitId=?";
      params.push(input.unitId);
    }
    fields =
      "u.id AS userId,u.username,u.name,u.status,ou.id AS unitId,ou.name AS unitName";
    order = "u.name,u.username,u.id,ou.id";
  } else {
    from =
      "FROM organization_unit_role our JOIN organization_unit ou ON ou.id=our.unitId WHERE our.roleId=?";
    fields = `ou.id AS unitId,ou.name AS unitName,ou.code AS unitCode,ou.status,our.includeDescendants,our.effectiveFrom,our.expiresAt,
      (ou.status='active' AND our.effectiveFrom<=NOW() AND (our.expiresAt IS NULL OR our.expiresAt>NOW())) AS effective`;
    order = "ou.name,ou.code,ou.id";
  }
  if (input.search) {
    const columns =
      input.kind === "sources"
        ? ["ou.name", "ou.code"]
        : ["u.name", "u.username", "u.email"];
    from += ` AND (${columns.map(column => `LOCATE(?,LOWER(COALESCE(${column},'')))>0`).join(" OR ")})`;
    params.push(...columns.map(() => input.search.toLowerCase()));
  }
  if (input.status) {
    from += ` AND ${input.kind === "sources" ? "ou" : "u"}.status=?`;
    params.push(input.status);
  }
  const [counts] = await db.query<mysql.RowDataPacket[]>(
    `${cte} SELECT COUNT(*) AS total ${from}`,
    params
  );
  const total = Number(counts[0].total);
  // Clamp after a revoke, expiry, or concurrent directory edit removes the last page.
  const offset = Math.min(
    input.offset,
    Math.max(0, Math.ceil(total / input.limit) - 1) * input.limit
  );
  const [items] = await db.query<mysql.RowDataPacket[]>(
    `${cte} SELECT ${fields} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, input.limit, offset]
  );
  return { items, total, offset, limit: input.limit };
}
