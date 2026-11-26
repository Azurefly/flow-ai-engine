import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { catalogSearchText } from "../client/src/lib/resource-catalog-search";
import { moveTabFocus } from "../client/src/lib/tab-navigation";

describe("资源目录检索", () => {
  it("名称、显示的资源类型和插件版本均可查找，连接配置和样本不进入检索", () => {
    const text = catalogSearchText({
      name: "人事台账", sourceType: "inline", connection: { secretRef: "private-ref" },
      sample: [{ 姓名: "样本员工" }],
    });
    expect(text).toContain("人事台账");
    expect(text).toContain("内联样本");
    expect(text).not.toContain("private-ref");
    expect(text).not.toContain("样本员工");
    expect(catalogSearchText({ name: "报表", pluginType: "connector", version: "1.2" })).toContain("connector 1.2");
  });
});

describe("分区键盘导航", () => {
  it("方向键循环、首尾键定位，焦点移动保留当前选择", () => {
    const tabs = Array.from({ length: 3 }, () => ({ focus: vi.fn(), click: vi.fn() }));
    function press(key: string, from: number, ctrlKey = false) {
      const preventDefault = vi.fn();
      moveTabFocus({
        key, ctrlKey, target: tabs[from], preventDefault,
        currentTarget: { querySelectorAll: () => tabs },
      } as unknown as KeyboardEvent<HTMLElement>);
      return preventDefault;
    }
    expect(press("ArrowLeft", 0)).toHaveBeenCalledOnce();
    expect(tabs[2].focus).toHaveBeenCalledOnce();
    press("ArrowRight", 2);
    press("End", 1);
    press("Home", 1);
    expect(tabs[0].focus).toHaveBeenCalledTimes(2);
    expect(tabs[2].focus).toHaveBeenCalledTimes(2);
    expect(press("Enter", 1)).not.toHaveBeenCalled();
    expect(press("ArrowRight", 0, true)).not.toHaveBeenCalled();
    expect(tabs.every(tab => !tab.click.mock.calls.length)).toBe(true);
  });
});
