import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

type Row = Record<string, any>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function organizationUnitToken(row: Row) {
  return hash([
    row.id,
    row.code,
    row.name,
    row.parentUnitId ?? null,
    row.managerUserId == null ? null : Number(row.managerUserId),
    row.unitType ?? null,
    row.unitLevel == null ? null : Number(row.unitLevel),
    row.standardCode ?? null,
    row.areaCode ?? null,
    row.category ?? null,
    Number(row.sortOrder ?? 0),
    row.description ?? null,
    row.status,
  ]);
}
export function organizationMembershipToken(userId: number, rows: Row[]) {
  return hash([
    userId,
    rows
      .map(row => [
        String(row.id),
        String(row.unitId),
        Number(row.userId),
        row.title ?? null,
        Boolean(Number(row.isPrimary)),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}
export function organizationBindingToken(row: Row) {
  const date = (value: unknown) =>
    value == null ? null : new Date(value as string).toISOString();
  return hash([
    row.id,
    row.unitId,
    Number(row.roleId),
    Boolean(Number(row.includeDescendants)),
    date(row.effectiveFrom),
    date(row.expiresAt),
    Number(row.createdByUserId),
  ]);
}
export function assertOrganizationToken(
  expected: string | undefined,
  actual: string,
  label: string
) {
  if (expected && expected !== actual)
    throw new TRPCError({
      code: "CONFLICT",
      message: `${label}已被其他管理员修改，本次未保存。填写已保留，请重新读取并核对。`,
    });
}

export function organizationMembershipTokens(rows: Row[]) {
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const id = Number(row.userId);
    const bucket = groups.get(id) ?? [];
    bucket.push(row);
    groups.set(id, bucket);
  }
  return new Map(
    Array.from(groups, ([id, values]) => [
      id,
      organizationMembershipToken(id, values),
    ])
  );
}
