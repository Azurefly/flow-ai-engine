import { expect, it } from "vitest";
import {
  dataFieldEditorKey,
  newDataFieldItem,
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
