import { expect, it } from "vitest";
import {
  validateCustomRoleDraft,
  type CustomRoleDraft,
} from "./custom-role-form";
const draft: CustomRoleDraft = {
  code: "custom_reviewer",
  name: "审核员",
  description: "",
  scope: "system",
  permissions: ["workflow:view"],
};
it("整理表单但不改写原输入", () => {
  const input = {
    ...draft,
    code: " CUSTOM_REVIEWER ",
    name: " 审核员 ",
    permissions: ["workflow:view", "workflow:view"],
  };
  expect(validateCustomRoleDraft(input, ["workflow:view"])).toMatchObject({
    code: "custom_reviewer",
    name: "审核员",
    permissions: ["workflow:view"],
  });
  expect(input.permissions).toHaveLength(2);
});
it.each([
  { code: "admin" },
  { name: " " },
  { name: "x".repeat(121) },
  { description: "x".repeat(2001) },
  { permissions: [] },
  { permissions: ["iam:manage"] },
])("拒绝非法或不适用表单 %s", changes => {
  expect(() =>
    validateCustomRoleDraft({ ...draft, ...changes }, ["workflow:view"])
  ).toThrow();
});
