import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ResourceEditContext } from "../client/src/contexts/ResourceEditContext";
import { ResourcePermissionNotice } from "../client/src/components/ResourcePermissionNotice";

const render = (canEdit: boolean, refreshing = false) =>
  renderToStaticMarkup(
    createElement(
      ResourceEditContext.Provider,
      {
        value: {
          canEdit,
          canRun: false,
          ready: true,
          refreshing,
          refresh: () => {},
        },
      },
      createElement(ResourcePermissionNotice)
    )
  );

it("表单权限不可用时说明保留填写并允许刷新，读取中不重复提交刷新", () => {
  expect(render(false)).toContain('role="alert"');
  expect(render(false)).toContain("填写内容已保留");
  expect(render(false)).toContain("刷新业务权限");
  expect(render(false, true)).toContain('disabled=""');
  expect(render(true)).toBe("");
  expect(
    renderToStaticMarkup(createElement(ResourcePermissionNotice))
  ).toContain("权限暂不可用");
});

it("工作区定期确认权限，缓存读取失败时不可沿用编辑能力", () => {
  const source = readFileSync(
    "client/src/components/ProjectWorkspace.tsx",
    "utf8"
  );
  expect(source).toContain("authorizationQueryPolicy(true)");
  expect(source).toContain("!access.isPending && !access.isError");
  expect(source).toContain("ResourceEditContext.Provider");
  expect(source).toContain("...capabilities");
  expect(source).toContain('name="业务权限"');
  expect(source).toContain("access.isSuccess && !capabilities.ready");
  expect(source).toContain('data-project-access-denied=""');
  expect(source).toContain('lazy(() => import("./DataResourceCenter"))');
  expect(source).not.toContain(
    'import DataResourceCenter from "./DataResourceCenter"'
  );
});

it("资源门户表单保留打开状态和草稿，权限变化只停止提交", () => {
  const structured = readFileSync(
    "client/src/components/StructuredResourceForm.tsx",
    "utf8"
  );
  const center = readFileSync(
    "client/src/components/DataResourceCenter.tsx",
    "utf8"
  );
  for (const source of [structured, center]) {
    expect(source).toContain("if (!canEdit && !open) return null;");
    expect(source).toContain("<ResourcePermissionNotice />");
    expect(source).toContain("if (!canEdit) return;");
  }
  expect(center).toContain('error.data?.code === "FORBIDDEN"');
  expect(center).toContain("refreshPermissions()");
  expect(center).toContain("{canRun && (");
  expect(center).toContain("allowReadActions");
  expect(center).toContain("pending || disabled || !canEdit");
});
