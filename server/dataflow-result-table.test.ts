import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DataflowResultTable } from "../client/src/components/DataflowResultTable";

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
  expect(html).toContain(">0</td>");
  expect(html).toContain(">false</td>");
  expect(html).toContain('aria-label="结果下一页"');
});
