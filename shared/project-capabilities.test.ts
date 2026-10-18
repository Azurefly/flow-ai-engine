import { expect, it } from "vitest";
import { projectCapabilities } from "./project-capabilities";

it("查看者没有编辑或运行入口，运行者仅可正式运行", () => {
  expect(projectCapabilities(new Set(["project:view"]), true)).toEqual({
    ready: true,
    canManage: false,
    canCreate: false,
    canEdit: false,
    canRun: false,
  });
  expect(
    projectCapabilities(new Set(["project:view", "project:workflow:run"]), true)
  ).toMatchObject({ canRun: true, canEdit: false });
});
it("设计与运行能力分别判断，多项有效授权可同时生效", () => {
  const permissions = new Set([
    "project:view",
    "project:workflow:create",
    "project:workflow:edit",
  ]);
  expect(projectCapabilities(permissions, true)).toMatchObject({
    canCreate: true,
    canEdit: true,
    canRun: false,
  });
  permissions.add("project:workflow:run");
  expect(projectCapabilities(permissions, true)).toMatchObject({
    canEdit: true,
    canRun: true,
  });
});
it("权限读取中或失败时，即使缓存中有管理权限也不显示可执行操作", () => {
  const cached = new Set([
    "project:view",
    "project:manage",
    "project:workflow:edit",
    "project:workflow:run",
  ]);
  expect(projectCapabilities(cached, false)).toEqual({
    ready: false,
    canManage: false,
    canCreate: false,
    canEdit: false,
    canRun: false,
  });
  expect(projectCapabilities(undefined, true).ready).toBe(false);
  expect(projectCapabilities(new Set(["project:manage"]), true).canManage).toBe(
    false
  );
});
