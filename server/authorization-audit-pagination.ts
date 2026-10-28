import { z } from "zod";
import { authorizationAuditActions } from "../shared/role-audit-event";

const instant = z.number().int().min(0).max(253402300799999);
export const authorizationAuditPageInput = z
  .object({
    search: z.string().trim().max(160).default(""),
    category: z
      .enum(["all", "authentication", "account", "roles", "projects", "other"])
      .default("all"),
    from: instant.optional(),
    until: instant.optional(),
    snapshotBefore: instant.optional(),
    offset: z.number().int().min(0).max(10000000).default(0),
    limit: z.number().int().min(1).max(200).default(10),
  })
  .refine(
    input =>
      input.from === undefined ||
      input.until === undefined ||
      input.from < input.until,
    {
      message: "开始日期不能晚于结束日期。",
      path: ["until"],
    }
  );
export type AuthorizationAuditPageInput = z.input<
  typeof authorizationAuditPageInput
>;

// The physical history may use user_updated with a typed operation in details.
// Filter by the same semantic action that normalizeRoleAuditEvent displays.
const safeJson = "IF(JSON_VALID(a.detailsJson),a.detailsJson,'{}')";
const decoded = `JSON_UNQUOTE(${safeJson})`;
const operation = `JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(${decoded}),${decoded},'{}'),'$.operation'))`;

export const auditActionSql = `CASE WHEN a.action='user_updated' THEN
  CASE WHEN a.resourceType='iam_role' THEN CASE ${operation}
    WHEN 'custom_role_created' THEN 'role_created'
    WHEN 'custom_role_updated' THEN 'role_updated'
    WHEN 'custom_role_deleted' THEN 'role_deleted' ELSE a.action END
  WHEN a.resourceType='flow_project' THEN CASE ${operation}
    WHEN 'project_archived' THEN 'project_archived'
    WHEN 'project_restored' THEN 'project_restored' ELSE a.action END
  ELSE a.action END ELSE a.action END`;

export function authorizationAuditFilter(
  input: z.output<typeof authorizationAuditPageInput>,
  snapshotBefore: number
) {
  const conditions = ["a.createdAt < FROM_UNIXTIME(? / 1000)"];
  const args: (string | number)[] = [snapshotBefore];
  const codes = Object.keys(authorizationAuditActions);
  if (input.category !== "all") {
    const selected =
      input.category === "other"
        ? codes
        : codes.filter(
            code => authorizationAuditActions[code].category === input.category
          );
    conditions.push(
      `${auditActionSql} ${input.category === "other" ? "NOT IN" : "IN"} (${selected.map(() => "?").join(",")})`
    );
    args.push(...selected);
  }
  const search = input.search.toLowerCase();
  if (search) {
    const alternatives = [
      `INSTR(LOWER(CONCAT_WS(' ',a.id,a.action,${auditActionSql},actor.username,actor.name,target.username,target.name,a.resourceType,a.resourceId,a.requestId)),?) > 0`,
    ];
    args.push(search);
    const matching = codes.filter(code =>
      authorizationAuditActions[code].label.toLowerCase().includes(search)
    );
    if (matching.length) {
      alternatives.push(
        `${auditActionSql} IN (${matching.map(() => "?").join(",")})`
      );
      args.push(...matching);
    }
    if ("未识别操作".includes(search)) {
      alternatives.push(
        `${auditActionSql} NOT IN (${codes.map(() => "?").join(",")})`
      );
      args.push(...codes);
    }
    conditions.push(`(${alternatives.join(" OR ")})`);
  }
  if (input.from !== undefined) {
    if (input.from >= snapshotBefore) conditions.push("FALSE");
    else { conditions.push("a.createdAt >= FROM_UNIXTIME(? / 1000)"); args.push(input.from); }
  }
  if (input.until !== undefined && input.until < snapshotBefore) {
    conditions.push("a.createdAt < FROM_UNIXTIME(? / 1000)");
    args.push(input.until);
  }
  return { where: `WHERE ${conditions.join(" AND ")}`, args };
}
