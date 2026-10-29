import { expect, it } from "vitest";
import {
  dataFieldEditorKey,
  newDataFieldItem,
  updateDataFieldItem,
} from "../client/src/components/workflow-data-field-editor";
import { validateNodeConfig } from "../shared/workflow-node-contract";

it("creates node-specific data fields rather than form controls", () => {
  for (const [kind, valid] of [
    ["project", { source: "amount", target: "total" }],
    ["derive", { name: "copied", expression: "{{amount}}" }],
    ["sort", { field: "amount", direction: "desc" }],
  ] as const) {
    const key = dataFieldEditorKey(kind, "fields");
    const item = newDataFieldItem(key)!;
    expect(item).not.toHaveProperty("required");
    expect(() => validateNodeConfig(kind, { fields: [item] })).toThrow();
    expect(() =>
      validateNodeConfig(kind, { fields: [{ ...item, ...valid }] })
    ).not.toThrow();
  }
  expect(dataFieldEditorKey("form", "fields")).toBe("fields");
  expect(dataFieldEditorKey("derive", "other")).toBe("other");
});

it("选择排序方向时同步既有order别名，保留扩展属性及输入对象", () => {
  const legacy = Object.freeze({
    field: "amount",
    order: "desc",
    custom: { note: "保留" },
  });
  const changed = updateDataFieldItem("data_sort", legacy, "direction", "asc");
  expect(changed).toEqual({ ...legacy, direction: "asc", order: "asc" });
  expect(legacy.order).toBe("desc");
  expect(changed.custom).toBe(legacy.custom);
  expect(() => validateNodeConfig("sort", { fields: [changed] })).not.toThrow();
});

it("改字段名不改排序方向，新配置不引入旧别名", () => {
  expect(
    updateDataFieldItem(
      "data_sort",
      { field: "old", order: "desc" },
      "field",
      "new"
    )
  ).toEqual({ field: "new", order: "desc" });
  expect(
    updateDataFieldItem(
      "data_sort",
      { field: "amount", direction: "asc" },
      "direction",
      "desc"
    )
  ).toEqual({ field: "amount", direction: "desc" });
});

it("非排序节点的同名扩展字段不会被联动修改", () => {
  expect(
    updateDataFieldItem(
      "data_project",
      { source: "a", order: "custom" },
      "direction",
      "desc"
    )
  ).toEqual({ source: "a", order: "custom", direction: "desc" });
});
it("does not mutate defaults when editing a newly added row", () => {
  const item = newDataFieldItem("data_project")!;
  item.source = "amount";
  expect(newDataFieldItem("data_project")).toEqual({ source: "", target: "" });
});
it("rejects incomplete, conflicting and malformed fields before publication", () => {
  expect(() =>
    validateNodeConfig("project", {
      fields: [
        { source: "a", target: "x" },
        { source: "b", target: "x" },
      ],
    })
  ).toThrow("重复");
  expect(() =>
    validateNodeConfig("derive", {
      fields: [{ key: "field", label: "旧表单项", required: false }],
    })
  ).toThrow("派生");
  expect(() =>
    validateNodeConfig("sort", {
      fields: [{ field: "amount", direction: "sideways" }],
    })
  ).toThrow("方向");
  expect(() =>
    validateNodeConfig("sort", {
      fields: ["amount", { field: "name", direction: "DESC" }],
    })
  ).not.toThrow();
});
