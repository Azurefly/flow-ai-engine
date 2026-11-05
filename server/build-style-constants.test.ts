import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { compactStyleConstants } from "../scripts/build-style-constants";
const require = createRequire(import.meta.url);
const { parseAst } = createRequire(require.resolve("vite/package.json"))(
  "rollup/parseAst"
);
const style =
  "flex min-w-0 items-center gap-3 border-border bg-card text-muted-foreground";
it("跨作用域去重后，样式、事件调用、对象键、业务返回值及指令不变", () => {
  const code = `"use strict";const $C0=1;let calls=[];function view(value){let $C1=2;calls.push(value);return {className:${JSON.stringify(style)},value,$C1}}globalThis.output=[${JSON.stringify(style)},view(3),{${JSON.stringify(style)}:${JSON.stringify(style)}},view(5),calls,(function(){return this})(),$C0];`;
  const result = compactStyleConstants(code, parseAst)!;
  expect(result).not.toBeNull();
  const before: any = {},
    after: any = {};
  runInNewContext(code, before);
  runInNewContext(result.code, after);
  expect(JSON.stringify(after.output)).toBe(JSON.stringify(before.output));
  expect(result.code).toContain(`${JSON.stringify(style)}:`);
  expect(result.code.startsWith('"use strict";')).toBe(true);
  expect(Buffer.byteLength(result.code)).toBeLessThan(Buffer.byteLength(code));
});
it("不改写依赖路径、导入导出、URL、中文及短字符串", () => {
  const code = `import x from './bg-card text-muted-foreground';export {x};const values=['bg-card','bg-card','bg-card','中文 bg-card text-muted-foreground','https://test/bg-card text-muted-foreground'];`;
  expect(compactStyleConstants(code, parseAst)).toBeNull();
});
