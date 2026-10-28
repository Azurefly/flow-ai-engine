import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (path: string) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");
const css = read("client/src/index.css");
it("正文、控件与辅助信息全站共享字号，首页没有额外放大规则", () => {
  expect(css).toContain("--aiflow-type-body: 0.875rem;");
  expect(css).toContain("--aiflow-type-control: 0.875rem;");
  expect(css).toContain("--aiflow-type-meta: 0.8125rem;");
  expect(css).toContain("--aiflow-type-section: 1rem;");
  expect(css).toContain("--aiflow-type-dialog-title: 1.125rem;");
  expect(css).toContain("--aiflow-type-page-title: 1.375rem;");
  expect(css).not.toMatch(
    /\[data-aiflow-business-center\] \.aiflow-type-(body|meta)\s*\{/
  );
  expect(css).not.toContain('[class*="text-sm"]');
  expect(css).not.toContain("max-width: none !important;");
});
it("主要页面共用内容宽度和留白，次级导航按明确折叠状态伸缩", () => {
  for (const path of [
    "ProjectWorkspace",
    "SystemConfigShell",
    "ProcessWorkbench",
    "OrganizationManagementPage",
    "WorkflowWarehouse",
  ])
    expect(read(`client/src/components/${path}.tsx`)).toContain(
      "aiflow-page-content"
    );
  expect(read("client/src/pages/Home.tsx")).toContain(
    'data-aiflow-identity-page=""'
  );
  expect(css).toContain("--aiflow-content-max: 1440px;");
  expect(css).toContain("--aiflow-subnav-width: 192px;");
  expect(css).toContain(
    '[data-aiflow-project-workspace][data-navigation-collapsed="true"] > aside'
  );
  expect(css).toContain(
    '.aiflow-split-layout[data-navigation-collapsed="true"]'
  );
  expect(css).not.toContain(":has(> div > aside button[aria-label=");
});
it("创建、普通与确认弹窗使用相同的18px标题层级", () => {
  for (const path of ["ui/dialog", "ui/alert-dialog", "CreationDialog"])
    expect(read(`client/src/components/${path}.tsx`)).toContain(
      "aiflow-type-dialog-title"
    );
});

it("桌面审计记录的六个单元格固定在同一行，避免状态列让后续字段换行", () => {
  expect(css).toMatch(
    /@media \(min-width: 1024px\)\s*\{\s*\[data-iam-audit-row\] > div:first-child > \*\s*\{\s*grid-row: 1;/
  );
});
it("dialog motion never interpolates responsive width or viewport height", () => {
  for (const name of ["dialog", "alert-dialog"]) {
    const source = readFileSync(
      new URL(`../client/src/components/ui/${name}.tsx`, import.meta.url),
      "utf8"
    );
    expect(source).toContain("transition-opacity duration-200");
    expect(source).not.toContain("transition-all");
  }
});

it("流程管理标题不继承旧装饰卡片，工作区使用统一冷色表面", () => {
  expect(css).not.toContain("#eaf4df");
  expect(css).not.toContain("#20332d");
  expect(css).toMatch(/\[data-workspace-process-center\] > \[data-aiflow-context-header\]\s*\{\s*background-image: none;\s*box-shadow: none;\s*border-radius: 0;/);
});
