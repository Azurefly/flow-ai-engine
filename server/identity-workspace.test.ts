import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { IdentityWorkspace } from "../client/src/components/IdentityWorkspace";

it.each([
  ["users", "#/system/identity"],
  ["roles", "#/system/identity/roles"],
  ["organization", "#/system/organization"],
  ["audit", "#/system/identity/audit"],
] as const)("%s 只有一个选中模块，所有分类均为可访问的原生地址", (active, href) => {
  const html = renderToStaticMarkup(
    React.createElement(IdentityWorkspace, { active, onNavigate: vi.fn(), children: React.createElement("h1", null, "当前模块内容") })
  );
  expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
  expect((html.match(/<a /g) ?? []).length).toBe(4);
  expect(html).toContain(`href="${href}"`);
  expect(html).toMatch(new RegExp(`href="${href}"[^>]*aria-current="page"`));
  expect(html).toContain('aria-label="用户与权限分类"');
  expect(html).toContain('aria-label="收起用户与权限导航"');
  expect(html).not.toContain('role="tablist"');
  expect(html).toContain("当前模块内容");
});
