import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { IdentifierText } from "../client/src/components/IdentifierText";

it("空值和短标识保持原文本，不添加显示占位或修改标识", () => {
  expect(renderToStaticMarkup(createElement(IdentifierText))).toBe(
    "<span></span><span></span>"
  );
  expect(
    renderToStaticMarkup(createElement(IdentifierText, { value: "账号😀" }))
  ).toBe("<span></span><span>账号😀</span>");
});

it("长标识的两段完整连接为原值，后缀不产生半个Unicode字符", () => {
  const value = "长账号名称".repeat(20) + "一二三四五六😀🚀";
  const html = renderToStaticMarkup(createElement(IdentifierText, { value }));
  const segments = [...html.matchAll(/<span>([^<]*)<\/span>/g)].map(
    match => match[1]
  );
  expect(segments.join("")).toBe(value);
  expect(segments[1]).toBe("一二三四五六😀🚀");
});

it("标识中的HTML字符作为文本输出，不成为标签", () => {
  const html = renderToStaticMarkup(
    createElement(IdentifierText, { value: "<admin>&" })
  );
  expect(html).toContain("&lt;admin&gt;&amp;");
  expect(html).not.toContain("<admin>");
});
