import { isValidElement, type ReactElement } from "react";
import { expect, it } from "vitest";
import { TaskFormSchemaEditor } from "../client/src/components/TaskFormSchemaEditor";

function elements(node: unknown): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}
function editor(value: unknown, disabled = false) {
  let changed: any;
  const tree = TaskFormSchemaEditor({
    value,
    disabled,
    advanced: null,
    onChange: next => {
      changed = next;
    },
  });
  return { all: elements(tree), value: () => changed };
}
it("adds unique field codes while preserving schema extension properties", () => {
  const view = editor({
    version: 7,
    fields: [{ key: "field_2", custom: true }],
  });
  view.all
    .find(item => item.props.children === "添加表单字段")!
    .props.onClick();
  expect(view.value()).toEqual({
    version: 7,
    fields: [
      { key: "field_2", custom: true },
      { key: "field_3", label: "新字段", type: "text", required: false },
    ],
  });
});
it("reorders complete fields without losing types, defaults or extension properties", () => {
  const first = {
    key: "a",
    label: "甲",
    defaultValue: false,
    custom: { x: 1 },
  };
  const second = { key: "b", label: "乙", type: "number", defaultValue: 0 };
  const view = editor({ fields: [first, second] });
  view.all.find(item => item.props["aria-label"] === "上移乙")!.props.onClick();
  expect(view.value().fields).toEqual([second, first]);
});
it("edits option labels without converting numeric values or discarding metadata", () => {
  const view = editor({
    fields: [
      {
        key: "tags",
        label: "标签",
        type: "multiselect",
        options: [{ value: 1, label: "一", custom: true }],
      },
    ],
  });
  view.all
    .find(item => item.props["aria-label"] === "标签选项1名称")!
    .props.onChange({ target: { value: "新的名称" } });
  expect(view.value().fields[0].options).toEqual([
    { value: 1, label: "新的名称", custom: true },
  ]);
});
it("shows validation failures and disables all controls for read-only workflow access", () => {
  const view = editor(
    {
      fields: [{ key: "x", required: true, readOnly: true, defaultValue: "" }],
    },
    true
  );
  expect(view.all[0].props.disabled).toBe(true);
  expect(
    view.all.find(item => item.props.role === "alert")?.props.children
  ).toContain("默认值无效");
});
