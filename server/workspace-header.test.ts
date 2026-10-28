import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Workflow, Users } from "lucide-react";
import { expect, it, vi } from "vitest";
import { WorkspaceHeader } from "../client/src/components/WorkspaceHeader";

const props = {
  platformName: "Flow AI Engine",
  user: { name: "管理员示例", role: "admin" },
  nav: [
    { id: "flows" as const, label: "流程设计", icon: Workflow },
    { id: "identity" as const, label: "用户与权限", icon: Users },
  ],
  activeSection: "identity" as const,
  systemRootView: "config" as const,
  onSearch: vi.fn(),
  onNavigate: vi.fn(),
  onLogout: vi.fn(),
  mobileOpen: false,
  onOpenMobile: vi.fn(),
};
it("导航保持真实地址和当前模块身份，账号操作使用有名称的菜单入口", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceHeader, props));
  expect(html).toContain('href="#/flows"');
  expect(html).toContain('href="#/system/identity"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('aria-label="账户菜单：管理员示例"');
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).not.toContain("退出登录</button>");
});
it("受限账号不凭外观生成未经授权的管理入口", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceHeader, {
      ...props,
      nav: props.nav.slice(0, 1),
      activeSection: "flows",
      user: { name: "普通用户", role: "user" },
    })
  );
  expect(html).not.toContain('href="#/system/identity"');
  expect(html).not.toContain('href="#/system"');
  expect(html).toContain('href="#/flows"');
});
