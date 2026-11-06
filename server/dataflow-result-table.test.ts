import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DataflowResultTable } from "../client/src/components/DataflowResultTable";
import { dataflowResultValue, dataflowResultValueKind } from "../shared/dataflow-result-preview";
import { RunPayloadDetails } from "../client/src/components/RunPayloadDetails";

it("空输出明确显示零行，与暂无执行记录区分", () => {
  const html = renderToStaticMarkup(createElement(DataflowResultTable, { rows: [], title: "节点输出预览" }));
  expect(html).toContain("节点输出预览 · 共 0 行");
  expect(html).not.toContain("暂无");
});
it("节点与最终结果统一限制每页十行，并保留后续行的新字段与零值", () => {
  const rows = Array.from({ length: 12 }, (_, id) => id === 11 ? { id, laterField: "末行字段" } : { id, amount: 0, enabled: false });
  const html = renderToStaticMarkup(createElement(DataflowResultTable, { rows, title: "节点输出预览" }));
  expect(html.match(/<tbody>([\s\S]*)<\/tbody>/)?.[1].match(/<tr/g)).toHaveLength(10);
  expect(html).toContain("laterField");
  const values = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].replace(/<[^>]+>/g, ""));
  expect(values).toContain("0");
  expect(values).toContain("false");
  expect(html).toContain('aria-label="结果下一页"');
});

it("预览不切断emoji代理对，全文保留长中文、URL和换行", () => {
  const value = "a".repeat(92) + "😀" + "\n长文本" + "https://example.invalid/" + "x".repeat(3000);
  expect(dataflowResultValue(value)).toBe("a".repeat(92) + "…");
  expect(dataflowResultValue(value, false)).toBe(value);
});

it("全文区分空串、缺失、空值与零和false，不改原对象", () => {
  expect([undefined, null, "", 0, false].map(dataflowResultValueKind)).toEqual(["缺失值", "空值", "空字符串", "数字", "布尔值"]);
  expect([undefined, null, "", 0, false].map(value => dataflowResultValue(value, false))).toEqual(["未提供", "null", "", "0", "false"]);
  const original = Object.freeze({ text: "长中文\n😀", zero: 0, ok: false });
  expect(JSON.parse(dataflowResultValue(original, false))).toEqual(original);
});

it("运行字段预览不会产生半个emoji，全文仍完整保留", () => {
  const value = "x".repeat(1599) + "😀" + "末尾".repeat(100);
  const html = renderToStaticMarkup(createElement(RunPayloadDetails, { title: "长字段", value, kind: "input" }));
  expect(html.match(/data-payload-preview="">([^<]*)<\/div>/)?.[1]).toBe("x".repeat(1599) + "…");
  expect(html).toContain(value);
});

it("深层记录保留摘要并提供完整数据入口，关闭时不序列化大对象", () => {
  let serialized = 0;
  const value = { a: { b: { c: { d: { e: { f: { tail: "DEEP_TAIL" } } } } } } };
  Object.defineProperty(value.a, "toJSON", { value: () => { serialized++; return value.a; } });
  const html = renderToStaticMarkup(createElement(RunPayloadDetails, { title: "深层记录", value, kind: "input" }));
  expect(html).toContain("内容层级较深，已收起");
  expect(html).toContain("查看完整数据（JSON）");
  expect(html).not.toContain("DEEP_TAIL");
  expect(serialized).toBe(0);
});

it("超过80字段仍可请求查看全文，摘要不渲染后续字段也不改写原值", () => {
  const value = Object.freeze(Object.fromEntries(Array.from({ length: 81 }, (_, i) => [`field${i}`, i])));
  const html = renderToStaticMarkup(createElement(RunPayloadDetails, { title: "宽记录", value, kind: "input" }));
  expect(html).toContain("字段较多，仅展示前 80 项。");
  expect(html).toContain("查看完整数据（JSON）");
  expect(html).not.toContain("field80");
  expect(Object.keys(value)).toHaveLength(81);
  expect(value.field80).toBe(80);
});
