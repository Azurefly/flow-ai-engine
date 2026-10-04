import { TRPCError } from "@trpc/server";
import type { RowDataPacket } from "mysql2/promise";
import { getSharedPool } from "./db";
import { hasWorkflowPermission } from "./iam-service";
import { normalizeReferenceOperateConfig } from "../shared/reference-operate-config";

export async function searchWorkflowParticipants(
  user: { id: number; role: "user" | "admin" },
  input: {
    workflowId: string;
    kind: "user" | "department" | "role";
    query: string;
    selectedIds: string[];
    readOnly?: boolean;
  }
) {
  if (
    !(await hasWorkflowPermission(
      user,
      input.workflowId,
      input.readOnly ? "workflow:view" : "workflow:edit"
    ))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "无权配置此流程的处理人。",
    });
  const selectedIds = Array.from(new Set(input.selectedIds));
  if (selectedIds.length > 100 || input.query.length > 100)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "搜索词或已选项目数量超出限制。",
    });
  const query = input.query.trim().toLocaleLowerCase();
  if (input.readOnly) {
    if (query)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "只读预览不支持搜索人员目录。",
      });
    const [rows] = await getSharedPool().query<RowDataPacket[]>(
      "SELECT definitionJson FROM workflow WHERE id=?",
      [input.workflowId]
    );
    const raw = rows[0]?.definitionJson;
    const definition = typeof raw === "string" ? JSON.parse(raw) : raw;
    const allowed = new Set<string>();
    for (const node of definition?.nodes ?? []) {
      if (node.type !== "operate") continue;
      const config = node.config ?? {};
      const values =
        input.kind === "user"
          ? [
              config.assigneeUserId,
              ...normalizeReferenceOperateConfig(config).signSelectorUserIds,
            ]
          : input.kind === "department"
            ? Array.isArray(config.assigneeUnitIds)
              ? config.assigneeUnitIds
              : []
            : [config.assigneeRoleCode];
      values
        .filter(
          (value: unknown) =>
            value !== undefined && value !== null && value !== ""
        )
        .forEach((value: unknown) => allowed.add(String(value)));
    }
    if (selectedIds.some(id => !allowed.has(id)))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "只能查看此流程已配置的处理人。",
      });
  }
  if (input.kind === "role") {
    const pool = getSharedPool();
    const [selected] = selectedIds.length
      ? await pool.query<RowDataPacket[]>(
          `SELECT code,name FROM iam_role WHERE code IN (${selectedIds.map(() => "?").join(",")})`,
          selectedIds
        )
      : [[]];
    const [matches] = query
      ? await pool.query<RowDataPacket[]>(
          "SELECT code,name FROM iam_role WHERE LOCATE(?,LOWER(name))>0 OR LOCATE(?,LOWER(code))>0 ORDER BY code LIMIT 51",
          [query, query]
        )
      : [[]];
    const option = (row: RowDataPacket) => ({
      value: String(row.code),
      label: `${row.name}（${row.code}）`,
    });
    return {
      items: matches.slice(0, 50).map(option),
      selected: selected.map(option),
      hasMore: matches.length > 50,
    };
  }
  const people = input.kind === "user";
  const table = people ? "users" : "organization_unit";
  const code = people ? "username" : "code";
  const columns = `id, name, ${code}`;
  const pool = getSharedPool();
  const [selected] = selectedIds.length
    ? await pool.query<RowDataPacket[]>(
        `SELECT ${columns} FROM ${table} WHERE status='active' AND id IN (${selectedIds.map(() => "?").join(",")})`,
        selectedIds
      )
    : [[]];
  const [matches] = query
    ? await pool.query<RowDataPacket[]>(
        `SELECT ${columns} FROM ${table} WHERE status='active' AND (LOCATE(?,LOWER(COALESCE(name,'')))>0 OR LOCATE(?,LOWER(${code}))>0) ORDER BY ${code}, id LIMIT 51`,
        [query, query]
      )
    : [[]];
  const option = (row: RowDataPacket) => ({
    value: String(row.id),
    label: row.name ? `${row.name}（${row[code]}）` : String(row[code]),
  });
  return {
    items: matches.slice(0, 50).map(option),
    selected: selected.map(option),
    hasMore: matches.length > 50,
  };
}
