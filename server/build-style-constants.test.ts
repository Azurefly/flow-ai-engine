import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
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
  const result = compactStyleConstants(code, parseAst) ?? { code };
  const before: any = {},
    after: any = {};
  runInNewContext(code, before);
  runInNewContext(result.code, after);
  expect(JSON.stringify(after.output)).toBe(JSON.stringify(before.output));
  expect(result.code).toContain(`${JSON.stringify(style)}:`);
  expect(result.code.startsWith('"use strict";')).toBe(true);
  expect(Buffer.byteLength(result.code)).toBeLessThanOrEqual(
    Buffer.byteLength(code)
  );
  expect(gzipSync(result.code).length).toBeLessThanOrEqual(gzipSync(code).length);
});

it("共享常量始终服从调用方提供的 gzip 上限，保留独立对象和闭包事件值", () => {
  const code = `let calls=[];const a={className:${JSON.stringify(style)},click:()=>calls.push(1)};const b={className:${JSON.stringify(style)},click:()=>calls.push(2)};a.click();b.click();globalThis.output=[a.className,b.className,calls,a===b];`;
  const ceiling = gzipSync(code).length + 16;
  const result = compactStyleConstants(code, parseAst, ceiling) ?? { code };
  const before: any = {}, after: any = {};
  runInNewContext(code, before);
  runInNewContext(result.code, after);
  expect(JSON.stringify(after.output)).toBe(JSON.stringify(before.output));
  expect(gzipSync(result.code).length).toBeLessThanOrEqual(ceiling);
});
it("不改写依赖路径、导入导出、URL、中文及短字符串", () => {
  const code = `import x from './bg-card text-muted-foreground';export {x};const values=['bg-card','bg-card','bg-card','中文 bg-card text-muted-foreground','https://test/bg-card text-muted-foreground'];`;
  expect(compactStyleConstants(code, parseAst)).toBeNull();
});

it("跨压缩窗口重复内容被实际共享，结果与业务调用保持一致", () => {
  const gap = ";".repeat(40000);
  const code = `const a=${JSON.stringify(style)};${gap}const b=${JSON.stringify(style)};${gap}const c=${JSON.stringify(style)};globalThis.output=[a,b,c];`;
  const optimized = compactStyleConstants(code, parseAst);
  expect(optimized).not.toBeNull();
  const before: any = {},
    after: any = {};
  runInNewContext(code, before);
  runInNewContext(optimized!.code, after);
  expect(JSON.stringify(after.output)).toBe(JSON.stringify(before.output));
});
