import { TRPCError } from "@trpc/server";
import type { RowDataPacket } from "mysql2/promise";
import { getSharedPool } from "./db";
import { hasWorkflowPermission } from "./iam-service";

export async function searchWorkflowParticipants(
  user: { id: number; role: "user" | "admin" },
  input: {
    workflowId: string;
    kind: "user" | "department";
    query: string;
    selectedIds: string[];
  }
) {
  if (!(await hasWorkflowPermission(user, input.workflowId, "workflow:edit")))
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
