import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DataflowCancellationInfo } from "../client/src/components/DataflowCancelControl";
it("取消原因与操作者按文本转义，长原因保留完整内容与换行", () => {
  const reason = "超长原因".repeat(70) + "\n<script>alert(1)</script>";
  const html = renderToStaticMarkup(createElement(DataflowCancellationInfo, { cancellation: { actorLabel: "<admin>", cancelledAt: "2026-11-05T03:00:00Z", reason } }));
  expect(html).toContain("超长原因".repeat(70));
  expect(html).toContain("\n&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("&lt;admin&gt;");
  expect(html).not.toContain("<script>");
});
it("没有取消元数据时不捏造取消信息", () => {
  expect(renderToStaticMarkup(createElement(DataflowCancellationInfo, {}))).toBe("");
});
