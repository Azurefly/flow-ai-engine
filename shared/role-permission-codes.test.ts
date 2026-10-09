import { expect, it } from "vitest";
import { readRolePermissionCodes } from "./role-permission-codes";
it.each([null, undefined, "invalid", "{}", 1])("异常角色权限安全返回空列表：%s", value => {
  expect(readRolePermissionCodes(value)).toEqual([]);
});
it("解析数据库 JSON 并过滤重复和非法权限", () => {
  expect(readRolePermissionCodes('["workflow:view","workflow:view",null,"",12]')).toEqual(["workflow:view"]);
});
