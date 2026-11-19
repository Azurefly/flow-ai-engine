import { z } from "zod";

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9._-]{2,63}$/);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_-]{1,63}$/);
const name = z.string().trim().min(1).max(160);
export const directoryManifest = z
  .object({
    version: z.literal(1),
    users: z
      .array(
        z
          .object({
            username,
            name,
            email: z.string().trim().email().max(320).nullable().optional(),
          })
          .strict()
      )
      .max(200)
      .default([]),
    units: z
      .array(z.object({ code, name, parentCode: code.optional() }).strict())
      .max(200)
      .default([]),
    memberships: z
      .array(
        z
          .object({
            username,
            unitCode: code,
            title: z.string().trim().max(160).nullable().optional(),
          })
          .strict()
      )
      .max(200)
      .default([]),
  })
  .strict()
  .refine(value => {
    const count =
      value.users.length + value.units.length + value.memberships.length;
    return count >= 1 && count <= 200;
  }, "一个批次需要 1 至 200 行。");
export type DirectoryManifest = z.infer<typeof directoryManifest>;
export type DirectoryRecord =
  | ({ kind: "user" } & DirectoryManifest["users"][number])
  | ({ kind: "unit" } & DirectoryManifest["units"][number])
  | ({ kind: "membership" } & DirectoryManifest["memberships"][number]);
export function directoryKey(row: DirectoryRecord) {
  if (row.kind === "user") return "user/" + row.username;
  if (row.kind === "unit") return "unit/" + row.code;
  return "membership/" + row.username + "/" + row.unitCode;
}

export function orderDirectoryRows(input: DirectoryManifest) {
  const users = input.users.map(r => ({ ...r, kind: "user" as const }));
  const units = input.units.map(r => ({ ...r, kind: "unit" as const }));
  const memberships = input.memberships.map(r => ({
    ...r,
    kind: "membership" as const,
  }));
  const rows = [...users, ...units, ...memberships];
  const issues = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = directoryKey(row);
    if (seen.has(key)) issues.set(key, "同一标识在文件中出现多次。");
    seen.add(key);
  }
  const ordered: typeof units = [];
  const pending = [...units],
    ready = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex(
      u =>
        !u.parentCode ||
        !seen.has("unit/" + u.parentCode) ||
        ready.has(u.parentCode)
    );
    if (index < 0) {
      for (const u of pending)
        issues.set(directoryKey(u), "上级部门构成循环或依赖该循环。");
      ordered.push(...pending);
      break;
    }
    const [unit] = pending.splice(index, 1);
    ordered.push(unit);
    ready.add(unit.code);
  }
  return { rows: [...users, ...ordered, ...memberships], issues };
}
