import { describe, expect, it } from "vitest";
import { isActiveWindow, validateRoleCode, validateRolePermissions } from "./iam-service";

describe("IAM 临时授权窗口", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");

  it("仅在生效时间之后、到期时间之前且未撤销时返回有效", () => {
    expect(isActiveWindow(new Date("2026-08-14T00:00:00.000Z"), new Date("2026-08-16T00:00:00.000Z"), null, now)).toBe(true);
    expect(isActiveWindow(new Date("2026-08-16T00:00:00.000Z"), null, null, now)).toBe(false);
    expect(isActiveWindow(new Date("2026-08-14T00:00:00.000Z"), new Date("2026-08-15T00:00:00.000Z"), null, now)).toBe(false);
    expect(isActiveWindow(new Date("2026-08-14T00:00:00.000Z"), null, new Date("2026-08-14T12:00:00.000Z"), now)).toBe(false);
  });
});

describe("自定义角色定义", () => {
  it("限制角色编码命名空间，并隔离流程范围与系统级权限", () => {
    expect(validateRoleCode(" Custom_report_reader ")).toBe("custom_report_reader");
    expect(() => validateRoleCode("system_admin")).toThrow("custom_");
    expect(validateRolePermissions("workflow", ["workflow:view", "workflow:view"])).toEqual(["workflow:view"]);
    expect(() => validateRolePermissions("workflow", ["iam:manage"])).toThrow("流程角色不能包含系统级权限");
  });
});
