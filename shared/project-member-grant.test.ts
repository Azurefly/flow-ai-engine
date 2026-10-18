import { expect, it } from "vitest";
import { canRevokeProjectGrant } from "./project-member-grant";

it("创建人的所有权不可移除，转授的业务管理员可移除", () => {
  expect(canRevokeProjectGrant({ role: "owner", protectedOwner: 1 })).toBe(
    false
  );
  expect(canRevokeProjectGrant({ role: "owner", protectedOwner: 0 })).toBe(
    true
  );
  expect(canRevokeProjectGrant({ role: "owner", protectedOwner: false })).toBe(
    true
  );
});
it("旧缓存缺少标识时保护所有者行，普通角色仍可按记录撤销", () => {
  expect(canRevokeProjectGrant({ role: "owner" })).toBe(false);
  expect(canRevokeProjectGrant({ role: "designer" })).toBe(true);
});
