import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { readRolePermissionCodes } from "../shared/role-permission-codes";

/** Includes the immutable id so deleting/recreating the same code cannot reuse a snapshot. */
export function customRoleConfigToken(role: Record<string, unknown>): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        Number(role.id),
        String(role.code),
        String(role.name),
        role.description == null ? null : String(role.description),
        String(role.scope),
        Boolean(Number(role.isSystem)),
        readRolePermissionCodes(role.permissions).sort(),
      ])
    )
    .digest("hex");
}

export function assertCustomRoleConfigToken(
  expected: string | undefined,
  role: Record<string, unknown>
) {
  if (!expected)
    throw new TRPCError({
      code: "CONFLICT",
      message: "请先读取最新角色配置，再保存或删除。当前填写内容已保留。",
    });
  if (expected !== customRoleConfigToken(role))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "角色配置已被其他管理员更新，本次修改未保存。请读取最新配置后重新核对。",
    });
}
