import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ResourceEditContext } from "../client/src/contexts/ResourceEditContext";
import { ResourcePermissionNotice } from "../client/src/components/ResourcePermissionNotice";
import { ResourceCatalogNotice } from "../client/src/components/ResourceCatalogNotice";
import { ResourceCatalogContext } from "../client/src/contexts/ResourceCatalogContext";

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
  expect(source).toContain("if (requestConsoleNavigation(proceed)) proceed();");
  expect(source).toContain("...capabilities");
  expect(source).toContain('name="业务权限"');
  expect(source).toContain("access.isSuccess && !capabilities.ready");
  expect(source).toContain('data-project-access-denied=""');
  expect(source).toContain('lazy(() => import("./DataResourceCenter"))');
  expect(source).not.toContain(
    'import DataResourceCenter from "./DataResourceCenter"'
  );
  expect(source).toContain("canRevokeProjectGrant(member)");
  expect(source).toContain("assignmentId: permissionRevocation.assignmentId");
  expect(source).toContain('member.protectedOwner ? "创建人"');
  expect(source).toContain(
    "Promise.all([access.refetch(), members.refetch(), workflows.refetch()])"
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
    expect(source).toContain("if (!canEdit || !catalog.ready) return;");
  }
  expect(center).toContain('error.data?.code === "FORBIDDEN"');
  expect(center).toContain("refreshPermissions()");
  expect(center).toContain("{canRun && (");
  expect(center).toContain("allowReadActions");
  expect(center).toContain("pending || disabled || !canEdit");
});

it("资源读取失败保留门户表单，并提供独立读取入口；读取中禁止重复刷新", () => {
  const notice = (ready: boolean, refreshing: boolean) =>
    renderToStaticMarkup(
      createElement(
        ResourceCatalogContext.Provider,
        {
          value: { ready, refreshing, refresh: () => {} },
        },
        createElement(ResourceCatalogNotice)
      )
    );
  expect(notice(true, false)).toBe("");
  expect(notice(false, false)).toContain('role="alert"');
  expect(notice(false, false)).toContain("填写内容已保留");
  expect(notice(false, false)).toContain("重新读取资源");
  expect(notice(false, true)).toContain('role="status"');
  expect(notice(false, true)).toContain('disabled=""');
  const center = readFileSync(
    "client/src/components/DataResourceCenter.tsx",
    "utf8"
  );
  const structured = readFileSync(
    "client/src/components/StructuredResourceForm.tsx",
    "utf8"
  );
  expect(center).toContain("<ResourceDraftGuard>");
  expect(center).toContain("resources.isSuccess && !resources.isFetching");
  expect(center).toContain("<ResourceCatalogNotice />");
  expect(center.match(/onError: reportResourceFormError/g)).toHaveLength(5);
  expect(center).toContain("toast.dismiss()");
  expect(structured).toContain("toast.dismiss()");
  for (const key of ["udfs", "tags", "plugins"]) {
    expect(center).toContain(`hidden={tab !== "${key}"}`);
  }
  expect(center).toContain("!resources.isLoading && !resources.error");
  expect(center).toContain("active={tab === kind}");
  expect(structured).toContain("hidden={!active}");
  expect(structured).toContain("disabled={!catalog.ready}");
  for (const label of ["数据源类型", "关联数据源", "资源类型"]) {
    expect(structured).toContain(`aria-label="${label}"`);
  }
  expect(structured).toContain("<ResourceCatalogNotice />");
});
