import { expect, it } from "vitest";
import {
  hasClientVersionChanged,
  isProductionClientEntry,
  readClientEntry,
} from "../shared/client-version";

it("读取生产入口，不受属性顺序和引号影响", () => {
  expect(
    readClientEntry(
      '<script type="module" crossorigin src="/assets/index-old_1.js"></script>'
    )
  ).toBe("/assets/index-old_1.js");
  expect(
    readClientEntry(
      "<script src='/assets/index-new-2.js' type='module'></script>"
    )
  ).toBe("/assets/index-new-2.js");
});
it("仅两侧都为有效生产入口且不同时提示更新", () => {
  expect(
    hasClientVersionChanged("/assets/index-old.js", "/assets/index-new.js")
  ).toBe(true);
  expect(
    hasClientVersionChanged("/assets/index-old.js", "/assets/index-old.js")
  ).toBe(false);
  expect(hasClientVersionChanged(null, "/assets/index-new.js")).toBe(false);
  expect(hasClientVersionChanged("/assets/index-old.js", null)).toBe(false);
});
it("开发页面、错误页、其他脚本和伪属性不触发更新", () => {
  for (const html of [
    "server unavailable",
    '<script type="module" src="/src/main.tsx">',
    '<script src="/assets/index-new.js">',
    '<script data-type="module" src="/assets/index-new.js">',
    '<script type="module" data-src="/assets/index-new.js">',
  ])
    expect(readClientEntry(html)).toBeNull();
  expect(
    isProductionClientEntry("https://example.com/assets/index-new.js")
  ).toBe(false);
});
