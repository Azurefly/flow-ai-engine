import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

export type SystemSettingKey = "general" | "approval";
export const DEFAULT_SYSTEM_SETTINGS = {
  general: {
    platformName: "Flow AI Engine",
    watermarkEnabled: false,
    watermarkText: "",
  },
  approval: {
    requireProjectApproval: true,
    reviewerMode: "project_owner_or_admin" as
      | "project_owner_or_admin"
      | "independent_reviewer",
  },
};
function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(normalize)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, entry]) => [key, normalize(entry)])
          )
        : item;
  return JSON.stringify(normalize(value));
}
export function readSystemSettingValue(
  key: SystemSettingKey,
  value: unknown
): Record<string, unknown> {
  return {
    ...DEFAULT_SYSTEM_SETTINGS[key],
    ...(value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {}),
  };
}
export function systemSettingConfigToken(
  key: SystemSettingKey,
  value: unknown
) {
  return createHash("sha256")
    .update(key + ":" + stableJson(readSystemSettingValue(key, value)))
    .digest("hex");
}
export function assertSystemSettingConfigToken(
  key: SystemSettingKey,
  expected: string | undefined,
  current: unknown
) {
  if (!expected)
    throw new TRPCError({
      code: "CONFLICT",
      message: "请先读取最新系统设置再保存，当前填写已保留。",
    });
  if (expected !== systemSettingConfigToken(key, current))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "该配置已被其他管理员更新，本次修改未保存。请先导出填写内容，再读取最新配置重新核对。",
    });
}
export function mergeSystemSettingValue(
  key: SystemSettingKey,
  existing: unknown,
  patch: Record<string, unknown>
) {
  const value = { ...readSystemSettingValue(key, existing), ...patch };
  if (key === "general") {
    const name =
      typeof value.platformName === "string" ? value.platformName.trim() : "";
    if (!name) throw new Error("平台名称不可为空。");
    if (name.length > 120) throw new Error("平台名称最多 120 个字符。");
    if (typeof value.watermarkEnabled !== "boolean")
      throw new Error("系统水印状态无效。");
    if (
      value.watermarkText !== undefined &&
      typeof value.watermarkText !== "string"
    )
      throw new Error("水印文本格式无效。");
    const text = String(value.watermarkText ?? "").trim();
    if (text.length > 120) throw new Error("水印文本最多 120 个字符。");
    if (value.watermarkEnabled && !text)
      throw new Error("开启水印时必须配置水印文本。");
    value.platformName = name;
    value.watermarkText = text;
  } else {
    if (typeof value.requireProjectApproval !== "boolean")
      throw new Error("发布审批状态无效。");
    if (
      !["project_owner_or_admin", "independent_reviewer"].includes(
        String(value.reviewerMode)
      )
    )
      throw new Error("审核人模式无效。");
  }
  return value;
}
