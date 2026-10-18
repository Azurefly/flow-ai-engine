import { expect, it } from "vitest";
import { customRoleDraftKey, CUSTOM_ROLE_PRESETS } from "./custom-role-editor";
import { validateCustomRoleDraft } from "./custom-role-form";
const draft = {
  code: "custom_test",
  name: "测试角色",
  description: "",
  scope: "workflow" as const,
  permissions: ["workflow:view", "workflow:edit"],
};
it("仅权限排序不构成未保存修改，名称、说明和权限变化需要保护", () => {
  expect(customRoleDraftKey(draft)).toBe(
    customRoleDraftKey({
      ...draft,
      permissions: ["workflow:edit", "workflow:view", "workflow:view"],
    })
  );
  for (const changes of [
    { name: "另一个名称" },
    { description: "说明" },
    { permissions: ["workflow:view"] },
  ])
    expect(customRoleDraftKey({ ...draft, ...changes })).not.toBe(
      customRoleDraftKey(draft)
    );
});
it("权限组合明确列出权限，身份管理不会自动夹带流程权限", () => {
  expect(
    CUSTOM_ROLE_PRESETS.find(preset => preset.label === "设计流程")?.permissions
  ).toEqual(["workflow:view", "workflow:edit"]);
  expect(
    CUSTOM_ROLE_PRESETS.find(preset => preset.label === "身份管理")?.permissions
  ).toEqual(["iam:manage"]);
  const allowed = [
    "workflow:view",
    "workflow:edit",
    "workflow:run",
    "workflow:publish",
  ];
  expect(
    CUSTOM_ROLE_PRESETS.filter(preset =>
      preset.permissions.every(code => allowed.includes(code))
    ).some(preset => preset.label === "身份管理")
  ).toBe(false);
});
it("表单提前拒绝数据库装不下的编码", () => {
  const code = "custom_a" + "b".repeat(56);
  expect(
    validateCustomRoleDraft({ ...draft, code }, draft.permissions).code
  ).toHaveLength(64);
  expect(() =>
    validateCustomRoleDraft({ ...draft, code: code + "c" }, draft.permissions)
  ).toThrow("64");
});
