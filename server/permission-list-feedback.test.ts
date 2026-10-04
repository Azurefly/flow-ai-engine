import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PermissionListFeedback } from "../client/src/components/PermissionListFeedback";
const render = (loading: boolean, error: boolean) =>
  renderToStaticMarkup(
    createElement(PermissionListFeedback, {
      name: "成员授权",
      loading,
      error,
      onRetry: () => {},
    })
  );
it("读取中说明正在加载，不宣称列表为空", () => {
  const html = render(true, false);
  expect(html).toContain('role="status"');
  expect(html).toContain("正在读取成员授权");
  expect(html).not.toContain("尚无");
});
it("读取失败展示错误及明确的重试按钮，不伪装空列表", () => {
  const html = render(false, true);
  expect(html).toContain('role="alert"');
  expect(html).toContain("已显示的内容可能不是最新状态");
  expect(html).toContain("重试读取成员授权");
  expect(html).toContain('type="button"');
});
it("成功后不残留加载或失败提示", () => expect(render(false, false)).toBe(""));
