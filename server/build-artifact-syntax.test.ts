import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

function check(code: string) {
  const directory = mkdtempSync(join(tmpdir(), "flow-bundle-gate-"));
  try {
    mkdirSync(join(directory, "dist/public/assets"), { recursive: true });
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    writeFileSync(join(directory, "dist/public/index.html"), "<!doctype html><main></main>");
    writeFileSync(join(directory, "dist/public/assets/fixture.js"), code);
    return spawnSync(process.execPath, [resolve("scripts/check-bundle-budget.mjs")], { cwd: directory, encoding: "utf8" });
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("flow-bundle-gate-")) throw new Error("Unexpected temporary fixture path");
    rmSync(directory, { recursive: true, force: true });
  }
}

it("产物即使很小也必须通过语法检查，拒绝真实遇到的无分隔 case 常量", () => {
  const result = check('switch (1) { case$C4: break; }');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("JavaScript syntax check failed: fixture.js");
});
it("正常 ES module 通过语法和体积门禁，不执行其中代码", () => {
  const result = check('export const marker="valid";throw new Error("must not execute")');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("JavaScript syntax verified: 1 modules");
});
