export type SettingsKey = "general" | "approval";
export type SettingsForm = {
  platformName: string;
  watermarkEnabled: boolean;
  watermarkText: string;
  requireProjectApproval: boolean;
  reviewerMode: "project_owner_or_admin" | "independent_reviewer";
};
export type SettingsDraft = {
  key: SettingsKey;
  token: string;
  base: SettingsForm;
  form: SettingsForm;
};
export const SETTINGS_LABELS = { general: "通用设置", approval: "审批配置" };
const fields: Record<
  SettingsKey,
  { field: keyof SettingsForm; label: string }[]
> = {
  general: [
    { field: "platformName", label: "平台名称" },
    { field: "watermarkEnabled", label: "系统水印" },
    { field: "watermarkText", label: "水印文字" },
  ],
  approval: [
    { field: "requireProjectApproval", label: "发布前审核" },
    { field: "reviewerMode", label: "审核人隔离策略" },
  ],
};
export function createSettingsDraft(
  key: SettingsKey,
  raw: Record<string, unknown>,
  token: string
): SettingsDraft {
  const base: SettingsForm = {
    platformName: String(raw.platformName ?? "Flow AI Engine"),
    watermarkEnabled: Boolean(raw.watermarkEnabled),
    watermarkText: String(raw.watermarkText ?? ""),
    requireProjectApproval: raw.requireProjectApproval !== false,
    reviewerMode:
      raw.reviewerMode === "independent_reviewer"
        ? "independent_reviewer"
        : "project_owner_or_admin",
  };
  return { key, token, base, form: { ...base } };
}
export function settingsDraftDiff(draft: SettingsDraft) {
  return fields[draft.key]
    .filter(item => draft.base[item.field] !== draft.form[item.field])
    .map(item => ({
      ...item,
      before: draft.base[item.field],
      after: draft.form[item.field],
    }));
}
export function settingsDraftFields(draft: SettingsDraft) {
  return Object.fromEntries(
    fields[draft.key].map(({ field }) => [field, draft.form[field]])
  );
}
export function settingsDraftPayload(draft: SettingsDraft) {
  const value = draft.form;
  if (draft.key === "approval")
    return {
      requireProjectApproval: value.requireProjectApproval,
      reviewerMode: value.reviewerMode,
    };
  const platformName = value.platformName.trim(),
    watermarkText = value.watermarkText.trim();
  if (!platformName) throw new Error("平台名称不可为空。");
  if (platformName.length > 120 || watermarkText.length > 120)
    throw new Error("平台名称和水印文字最多 120 个字符。");
  if (value.watermarkEnabled && !watermarkText)
    throw new Error("开启水印时必须配置水印文本。");
  return {
    platformName,
    watermarkEnabled: value.watermarkEnabled,
    watermarkText,
  };
}
export function settingChangeLabel(value: string | boolean) {
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (value === "independent_reviewer") return "独立复核（设计所有人不可自审）";
  if (value === "project_owner_or_admin") return "项目所有者或系统管理员";
  return value || "（空）";
}
