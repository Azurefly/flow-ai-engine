import { expect, it } from "vitest";
import {
  customRoleConfigToken,
  assertCustomRoleConfigToken,
} from "./custom-role-configuration";
import { validateRoleCode } from "./iam-service";
const role = {
  id: 42,
  code: "custom_review",
  name: "审核角色",
  description: null,
  scope: "workflow",
  isSystem: 0,
  permissions: ["workflow:view", "workflow:publish"],
};
it("权限顺序、重复项和 JSON 返回格式不影响快照", () => {
  const expected = customRoleConfigToken(role);
  expect(expected).toMatch(/^[a-f0-9]{64}$/);
  expect(
    customRoleConfigToken({
      ...role,
      permissions: '["workflow:publish",null,"workflow:view","workflow:view"]',
      isSystem: false,
    })
  ).toBe(expected);
});
it.each([
  { name: "其他管理员修改" },
  { description: "增加角色说明" },
  { scope: "system" },
  { permissions: ["workflow:view"] },
  { id: 43 },
  { isSystem: 1 },
])("实际配置变化使旧快照失效 %s", changes => {
  expect(customRoleConfigToken({ ...role, ...changes })).not.toBe(
    customRoleConfigToken(role)
  );
  expect(() =>
    assertCustomRoleConfigToken(customRoleConfigToken(role), {
      ...role,
      ...changes,
    })
  ).toThrow(/已被其他管理员更新/);
});
it("不依赖秒级时间戳，缺少快照不能写入", () => {
  const dated = { ...role, updatedAt: "2026-10-18 10:00:00" };
  expect(customRoleConfigToken(dated)).not.toBe(
    customRoleConfigToken({ ...dated, permissions: ["workflow:run"] })
  );
  expect(() => assertCustomRoleConfigToken(undefined, role)).toThrow(
    "先读取最新角色配置"
  );
  expect(() =>
    assertCustomRoleConfigToken(customRoleConfigToken(role), role)
  ).not.toThrow();
});
it("编码范围与数据库 64 字符列保持一致", () => {
  const code = "custom_a" + "b".repeat(56);
  expect(code).toHaveLength(64);
  expect(validateRoleCode(code)).toBe(code);
  expect(() => validateRoleCode(code + "b")).toThrow("64");
});
