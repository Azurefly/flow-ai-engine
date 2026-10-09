import { expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  listPermissionCatalog,
  validateRolePermissions,
} from "./iam-service";
it("角色编辑权限清单来自现有权威目录且名称说明完整", () => {
  const items = listPermissionCatalog();
  expect(items.map(item => item.code)).toEqual(ALL_PERMISSIONS);
  expect(items.every(item => item.name && item.description)).toBe(true);
  expect(items.find(item => item.code === "iam:manage")?.workflowAllowed).toBe(
    false
  );
  expect(
    items
      .filter(item => item.workflowAllowed)
      .every(item => item.code.startsWith("workflow:"))
  ).toBe(true);
});
it("创建流程属于全局权限，不能配置为单个流程的自定义权限", () => {
  expect(
    listPermissionCatalog().find(item => item.code === "workflow:create")
      ?.workflowAllowed
  ).toBe(false);
  expect(() =>
    validateRolePermissions("workflow", ["workflow:create"])
  ).toThrow("创建流程权限");
  expect(validateRolePermissions("system", ["workflow:create"])).toEqual([
    "workflow:create",
  ]);
});
