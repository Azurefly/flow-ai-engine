import type { CustomRoleDraft } from "./custom-role-form";
import { readRolePermissionCodes } from "./role-permission-codes";

export function customRoleDraftKey(draft: CustomRoleDraft) {
  return JSON.stringify([
    draft.code,
    draft.name,
    draft.description,
    draft.scope,
    readRolePermissionCodes(draft.permissions).sort(),
  ]);
}

export const CUSTOM_ROLE_PRESETS = [
  { label: "查看流程", permissions: ["workflow:view"] },
  { label: "设计流程", permissions: ["workflow:view", "workflow:edit"] },
  {
    label: "设计与发布",
    permissions: ["workflow:view", "workflow:edit", "workflow:publish"],
  },
  { label: "办理与运行", permissions: ["workflow:view", "workflow:run"] },
  { label: "身份管理", permissions: ["iam:manage"] },
] as const;
