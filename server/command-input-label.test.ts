import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const source = readFileSync(new URL("../client/src/components/ui/command.tsx", import.meta.url), "utf8");
it("cmdk 根标签继承搜索输入的可访问名称，保留显式标签优先级", () => {
  expect(source).toContain("child.type === CommandInput");
  expect(source).toContain('label={label ?? input?.props["aria-label"] ?? props["aria-label"] ?? "搜索选项"}');
});
