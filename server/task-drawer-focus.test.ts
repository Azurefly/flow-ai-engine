import { expect, it, vi } from "vitest";
import { restoreTaskDrawerFocus } from "../client/src/components/task-drawer-focus";
function button(id: string, visible = true, connected = true) {
  return { isConnected: connected, dataset: { taskOpenId: id }, getClientRects: () => visible ? [{}] : [], hasAttribute: () => false, focus: vi.fn() } as unknown as HTMLElement;
}
function root(buttons: HTMLElement[], body = button("body")) {
  return { body, querySelectorAll: () => buttons } as unknown as Document;
}
it("保留仍可见的原任务入口", () => {
  const opener = button("one");
  expect(restoreTaskDrawerFocus("one", opener, root([]))).toBe(opener);
  expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
});
it("原按钮被列表刷新替换后，跳过隐藏手机按钮并定位可见入口", () => {
  const hidden = button("one", false), visible = button("one"), other = button("two");
  expect(restoreTaskDrawerFocus("one", button("one", true, false), root([hidden, other, visible]))).toBe(visible);
  expect(hidden.focus).not.toHaveBeenCalled();
  expect(visible.focus).toHaveBeenCalledOnce();
});
it("不聚焦页面主体或已消失的任务", () => {
  const body = button("body");
  expect(restoreTaskDrawerFocus("missing", body, root([button("other")], body))).toBeNull();
  expect(body.focus).not.toHaveBeenCalled();
});
