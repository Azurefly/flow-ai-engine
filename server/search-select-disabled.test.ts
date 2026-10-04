import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/components/ui/button", () => ({
  Button: (props: any) => createElement("button", props),
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => children,
  PopoverTrigger: ({ children }: any) => children,
  PopoverContent: () => null,
}));
vi.mock("@/components/ui/command", () => ({
  Command: () => null,
  CommandEmpty: () => null,
  CommandGroup: () => null,
  CommandInput: () => null,
  CommandItem: () => null,
  CommandList: () => null,
}));
import { SearchableMultiSelect } from "../client/src/components/SearchableMultiSelect";

const render = (disabled: boolean) =>
  renderToStaticMarkup(
    createElement(SearchableMultiSelect, {
      ariaLabel: "审批人",
      value: ["17"],
      options: [{ value: "17", label: "测试审批人" }],
      query: "",
      onQueryChange: () => {},
      onChange: () => {},
      placeholder: "请选择",
      searchPlaceholder: "搜索",
      emptyMessage: "无结果",
      disabled,
    })
  );

it("只读选择器保留已选人员并禁用选择及移除按钮", () => {
  const html = render(true);
  expect(html).toContain("测试审批人");
  expect(html).toMatch(/<button[^>]*role="combobox"[^>]*disabled=""/);
  expect(html).toMatch(
    /<button[^>]*aria-label="移除测试审批人"[^>]*disabled=""/
  );
});

it("可编辑选择器仍可移除已选人员", () => {
  const html = render(false);
  expect(html).toContain('aria-label="移除测试审批人"');
  expect(html).not.toContain('disabled=""');
});
