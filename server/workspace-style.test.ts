import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("client/src/index.css", "utf8");
const home = readFileSync("client/src/pages/Home.tsx", "utf8");

describe("统一工作空间视觉与动效", () => {
  it("内容面板使用共享圆角和主题阴影，保留清晰的字号层级", () => {
    expect(css).toContain("--aiflow-surface-radius: 1.25rem;");
    expect(css).toContain("--aiflow-type-control: 0.875rem;");
    expect(css).toContain("--aiflow-type-page-title: 1.5rem;");
    expect(css).toContain("box-shadow: var(--aiflow-surface-shadow);");
    expect(css.match(/--aiflow-workspace-glow:/g)).toHaveLength(2);
    expect(css).not.toMatch(
      /\[data-aiflow-system-config\] > div\s*\{[^}]*gap: 0 !important/
    );
  });

  it("登录页介绍在桌面呈现，移动端保留原登录表单语义", () => {
    expect(home).toContain('data-login-introduction=""');
    expect(home).toContain('data-login-card=""');
    expect(home).toContain('autoComplete="username"');
    expect(home).toContain('autoComplete="current-password"');
    expect(css).toMatch(/\[data-login-introduction\]\s*\{\s*display: none/);
    expect(css).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*\[data-login-introduction\]\s*\{\s*display: grid/
    );
  });

  it("入场仅调整透明度，交互过渡受减少动态效果设置控制", () => {
    const keyframes = css.slice(
      css.indexOf("@keyframes aiflow-surface-in"),
      css.indexOf(
        '[data-slot="button"]',
        css.indexOf("@keyframes aiflow-surface-in")
      )
    );
    expect(keyframes).toContain("opacity: 0;");
    expect(keyframes).not.toMatch(/transform|height|width|infinite/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important;");
    expect(css).toContain("transition-duration: 0.01ms !important;");
  });
});
