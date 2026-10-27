import { expect, it } from "vitest";
import { formatConsoleRoute } from "./console-route";
import {
  primaryWorkspaceRoute,
  shouldHandlePrimaryNavigationClick,
} from "./primary-navigation";

it("所有页面的主导航使用同一组稳定地址，人员权限仍是独立入口", () => {
  expect(
    ["flows", "runs", "warehouse", "identity", "system"].map(section =>
      formatConsoleRoute(
        primaryWorkspaceRoute(
          section as Parameters<typeof primaryWorkspaceRoute>[0]
        )
      )
    )
  ).toEqual([
    "#/flows",
    "#/runs/workbench",
    "#/warehouse",
    "#/system/identity",
    "#/system",
  ]);
  expect(primaryWorkspaceRoute("system", "identity")).toEqual({
    section: "system",
    view: "identity",
  });
});
it("普通点击保留表单离开保护，组合键和中键保持浏览器原生行为", () => {
  const click = {
    button: 0,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  };
  expect(shouldHandlePrimaryNavigationClick(click)).toBe(true);
  for (const key of [
    "defaultPrevented",
    "ctrlKey",
    "metaKey",
    "shiftKey",
    "altKey",
  ] as const)
    expect(shouldHandlePrimaryNavigationClick({ ...click, [key]: true })).toBe(
      false
    );
  expect(shouldHandlePrimaryNavigationClick({ ...click, button: 1 })).toBe(
    false
  );
});
