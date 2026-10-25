import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const home = readFileSync(
  new URL("../client/src/pages/Home.tsx", import.meta.url),
  "utf8"
);
const system = readFileSync(
  new URL("../client/src/components/SystemConfigShell.tsx", import.meta.url),
  "utf8"
);
it("用户与权限位于主导航，组织与账号页使用同一个主导航选中项", () => {
  expect(home).toContain('id: "identity" as const, label: "用户与权限"');
  expect(home).toContain('systemView !== "config" ? "identity" : section');
  expect(home).toContain(
    "aria-labelledby={businessFocused ? undefined : `aiflow-console-tab-${activeSection}`}"
  );
  expect(home).toContain(
    'if (canManageIdentity) navigateRoute({ section: "system", view: "identity" })'
  );
  expect(system).not.toContain('id: "access"');
  expect(system).not.toContain("function AccessSettings");
  expect(home).toContain('aria-label="用户与权限分类"');
});
