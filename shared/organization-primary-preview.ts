type Membership = {
  unitId: string;
  unitName?: string;
  unitCode?: string;
  isPrimary?: boolean | number;
};
type Unit = { id: string; name?: string; code?: string };

/** Read-only preview of assignOrganizationMember; defaults and submission stay unchanged. */
export function organizationPrimaryPreview(
  rows: readonly Membership[],
  unit: Unit,
  isPrimary: boolean
) {
  const before = rows.find(row => row.isPrimary);
  const after = isPrimary
    ? { unitId: unit.id, unitName: unit.name, unitCode: unit.code }
    : before?.unitId === unit.id
      ? undefined
      : before;
  if (before?.unitId === after?.unitId) return null;
  const label = (row?: Membership) =>
    row
      ? `${row.unitName || row.unitId}${row.unitCode ? `（${row.unitCode}）` : ""}`
      : "未设置";
  return {
    before: label(before),
    after: label(after),
    action: after ? (before ? "切换主部门" : "设为主部门") : "取消主部门",
  };
}
