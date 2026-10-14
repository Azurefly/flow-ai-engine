import { expect, it } from "vitest";
import { taskFormViewFields } from "./task-form-view";
import { taskFormFieldErrors, taskFormRowValues } from "./task-form";

it("预览与办理共享默认值、顺序和只读字段，保留数字零与布尔否", () => {
  const schema = {
    fields: [
      { key: "amount", type: "number", defaultValue: 0 },
      { key: "enabled", type: "BOOLEAN" },
      { key: "tags", type: "multiselect", options: [1, 2], defaultValue: [1] },
      {
        key: "fixed",
        label: "固定信息",
        required: true,
        readOnly: true,
        defaultValue: "固定",
      },
    ],
  };
  const before = JSON.stringify(schema);
  const fields = taskFormViewFields(schema);
  expect(fields.map(field => field.defaultValue)).toEqual([
    "0",
    "false",
    "[1]",
    "固定",
  ]);
  const result = taskFormRowValues(
    fields,
    fields.map(field => ({ key: field.key, value: field.defaultValue }))
  );
  expect(result).toEqual({
    amount: 0,
    enabled: false,
    tags: [1],
    fixed: "固定",
  });
  expect(taskFormFieldErrors(schema.fields, result)).toEqual({});
  expect(JSON.stringify(schema)).toBe(before);
});

it("空字段和未设只读默认值保持原提交语义", () => {
  expect(taskFormViewFields(null)).toEqual([]);
  expect(
    taskFormViewFields({
      fields: [
        null,
        [],
        { key: " " },
        { key: "f", readOnly: true, type: "boolean" },
      ],
    })
  ).toEqual([
    {
      key: "f",
      label: "f",
      type: "boolean",
      required: false,
      readOnly: true,
      options: [],
      defaultValue: "",
    },
  ]);
});
