import type mysql from "mysql2/promise";

/** Current reads of the actual grant rows, never a materialized CTE snapshot.
 * The caller owns the transaction and has locked/validated the active account.
 */
export async function readLockedAssignedPermissions(
  connection: mysql.PoolConnection,
  userId: number,
  workflowId?: string
): Promise<Set<string>> {
  const [direct] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT roleId,scopeType FROM role_assignment WHERE userId=?
       AND revokedAt IS NULL AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW())
       AND ${workflowId ? "(scopeType='system' OR (scopeType='workflow' AND scopeId=?))" : "scopeType='system'"} FOR SHARE`,
    workflowId ? [userId, workflowId] : [userId]
  );
  const [memberships] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT ou.id,ou.parentUnitId FROM organization_membership om
       JOIN organization_unit ou ON ou.id=om.unitId AND ou.status='active'
      WHERE om.userId=? FOR SHARE`,
    [userId]
  );
  const ownUnits = new Set(memberships.map(row => String(row.id)));
  const units = new Set(ownUnits);
  let parents = memberships
    .map(row => row.parentUnitId)
    .filter(Boolean)
    .map(String);
  // Match the read-only permission resolver's maximum ancestor depth.
  for (let depth = 0; depth < 32 && parents.length; depth++) {
    const ids = Array.from(new Set(parents))
      .filter(id => !units.has(id))
      .sort();
    if (!ids.length) break;
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,parentUnitId FROM organization_unit WHERE id IN (?) AND status='active' ORDER BY id FOR SHARE",
      [ids]
    );
    rows.forEach(row => units.add(String(row.id)));
    parents = rows
      .map(row => row.parentUnitId)
      .filter(Boolean)
      .map(String);
  }
  const [inherited] = units.size
    ? await connection.query<mysql.RowDataPacket[]>(
        `SELECT roleId FROM organization_unit_role WHERE unitId IN (?)
           AND (unitId IN (?) OR includeDescendants=1)
           AND effectiveFrom<=NOW() AND (expiresAt IS NULL OR expiresAt>NOW()) FOR SHARE`,
        [Array.from(units).sort(), Array.from(ownUnits).sort()]
      )
    : [[]];
  const ids = Array.from(
    new Set([...direct, ...inherited].map(row => Number(row.roleId)))
  ).sort((a, b) => a - b);
  if (!ids.length) return new Set();
  const [roles] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id,code FROM iam_role WHERE id IN (?) ORDER BY id FOR SHARE",
    [ids]
  );
  const directSystem = new Set(
    direct
      .filter(row => row.scopeType === "system")
      .map(row => Number(row.roleId))
  );
  const allowed = roles
    .filter(
      row => row.code !== "system_admin" || directSystem.has(Number(row.id))
    )
    .map(row => Number(row.id));
  if (!allowed.length) return new Set();
  const [links] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT permissionId FROM role_permission WHERE roleId IN (?) ORDER BY roleId,permissionId FOR SHARE",
    [allowed]
  );
  const permissionIds = Array.from(
    new Set(links.map(row => Number(row.permissionId)))
  ).sort((a, b) => a - b);
  if (!permissionIds.length) return new Set();
  const [permissions] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT code FROM permission WHERE id IN (?) ORDER BY id FOR SHARE",
    [permissionIds]
  );
  return new Set(permissions.map(row => String(row.code)));
}
