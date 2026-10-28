export const authorizationAuditCategories: Record<string, string> = {
  all: "全部类别",
  authentication: "认证",
  account: "账号管理",
  roles: "角色授权",
  projects: "业务归档",
  other: "其他 / 未识别",
};
export type AuditCategory = "authentication" | "account" | "roles" | "projects";
export const authorizationAuditActions: Record<
  string,
  { label: string; category: AuditCategory }
> = {
  login_success: { label: "登录成功", category: "authentication" },
  login_failed: { label: "登录失败", category: "authentication" },
  logout: { label: "退出登录", category: "authentication" },
  user_created: { label: "创建账号", category: "account" },
  user_updated: { label: "更新账号或成员关系", category: "account" },
  user_disabled: { label: "停用账号", category: "account" },
  role_created: { label: "创建自定义角色", category: "roles" },
  project_archived: { label: "归档业务", category: "projects" },
  project_restored: { label: "恢复业务", category: "projects" },
  role_updated: { label: "修改自定义角色", category: "roles" },
  role_deleted: { label: "删除自定义角色", category: "roles" },
  role_assigned: { label: "授予角色", category: "roles" },
  role_revoked: { label: "撤销角色", category: "roles" },
  temporary_role_assigned: { label: "授予临时角色", category: "roles" },
  temporary_role_revoked: { label: "撤销临时角色", category: "roles" },
};

export function normalizeRoleAuditEvent<T extends Record<string, unknown>>(
  event: T
): T {
  if (
    event.action !== "user_updated" ||
    !["iam_role", "flow_project"].includes(String(event.resourceType))
  )
    return event;
  let details = event.detailsJson;
  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      return event;
    }
  }
  if (!details || typeof details !== "object" || Array.isArray(details))
    return event;
  const operations: Record<string, string> =
    event.resourceType === "flow_project"
      ? {
          project_archived: "project_archived",
          project_restored: "project_restored",
        }
      : {
          custom_role_created: "role_created",
          custom_role_updated: "role_updated",
          custom_role_deleted: "role_deleted",
        };
  const operation = (details as Record<string, unknown>).operation;
  if (typeof operation !== "string" || !Object.hasOwn(operations, operation))
    return event;
  return Object.assign({}, event, {
    action: operations[operation],
    legacyAction: event.action,
  });
}

/** Calendar-day bounds use the viewer's local timezone, including DST days. */
export function auditDateBounds(
  from: string,
  to: string
): { from?: number; until?: number; error?: string } {
  const start = from ? new Date(`${from}T00:00:00`) : undefined;
  const end = to ? new Date(`${to}T00:00:00`) : undefined;
  const valid = (value: string, date?: Date) =>
    !value ||
    (date &&
      Number.isFinite(date.getTime()) &&
      new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10) === value);
  if (!valid(from, start) || !valid(to, end))
    return { error: "请选择有效日期。" };
  if (from && to && from > to) return { error: "开始日期不能晚于结束日期。" };
  if (end) end.setDate(end.getDate() + 1);
  return { from: start?.getTime(), until: end?.getTime() };
}
