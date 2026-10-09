export type CustomRoleDraft = {
  code: string;
  name: string;
  description: string;
  scope: "system" | "workflow";
  permissions: string[];
};
export function validateCustomRoleDraft(
  draft: CustomRoleDraft,
  allowed: readonly string[]
) {
  const code = draft.code.trim().toLowerCase();
  const name = draft.name.trim();
  const description = draft.description.trim();
  const permissions = Array.from(new Set(draft.permissions));
  if (!/^custom_[a-z][a-z0-9_]{2,60}$/.test(code))
    throw new Error(
      "角色编码需以 custom_ 开头，后接小写字母、数字或下划线，首位必须为字母。"
    );
  if (!name || name.length > 120)
    throw new Error("角色名称需为 1 到 120 个字符。");
  if (description.length > 2000) throw new Error("角色说明最多 2000 个字符。");
  if (!permissions.length) throw new Error("请至少选择一项权限。");
  if (permissions.some(code => !allowed.includes(code)))
    throw new Error("包含当前范围不可使用的权限，请重新选择。");
  return { code, name, description, scope: draft.scope, permissions };
}
