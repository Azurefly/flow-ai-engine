import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("操作提示不拦截正文下方点击，并保留可关闭和可交互的消息动作", () => {
  const component = readFileSync("client/src/components/ui/sonner.tsx", "utf8");
  const style = readFileSync("client/src/index.css", "utf8");
  expect(component).toContain("closeButton");
  expect(component).toContain('closeButtonAriaLabel: "关闭提示"');
  expect(component).toContain('containerAriaLabel="操作提示"');
  expect(style).toMatch(
    /\.toaster\[data-sonner-toaster\] [^{}]*\[data-sonner-toast\]\s*\{\s*pointer-events: none;/
  );
  expect(style).toContain('[data-visible="true"]:not([data-removed="true"])');
  expect(style).toMatch(
    /:is\(button, a, input, select, textarea, \[role="button"\]\)\s*\{\s*pointer-events: auto;/
  );
  expect(style).toMatch(
    /@media \(pointer: coarse\)[\s\S]*?\[data-close-button\]\s*\{\s*width: 44px;\s*height: 44px;/
  );
  expect(style).toMatch(
    /\.toaster\[data-sonner-toaster\]\s+\[data-sonner-toast\]\s+\[data-close-button\]/
  );
});
