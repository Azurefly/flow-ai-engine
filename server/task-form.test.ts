import { expect, it } from "vitest";
import {
  assertTaskFormSchema,
  taskFormInputValue,
  validateFormSubmission,
  taskFormFieldErrors,
  taskFormRowValues,
} from "../shared/task-form";
it("keeps deliberate empty input instead of restoring defaults and preserves field types", () => {
  const fields = [
    { key: "text", type: "text", defaultValue: "001" },
    { key: "amount", type: "number" },
    { key: "fixed", readOnly: true },
  ];
  const values = taskFormRowValues(fields, [
    { key: "text", value: "" },
    { key: "amount", value: "0" },
    { key: "fixed", value: "" },
    { key: "decision", value: "rejected" },
  ]);
  expect(values).toEqual({ text: "", amount: 0 });
  expect(validateFormSubmission(fields, values)).toEqual({ amount: 0 });
  expect(
    taskFormFieldErrors([{ ...fields[0], required: true }], values).text
  ).toContain("必填");
  expect(taskFormRowValues(fields, [{ key: "text", value: "true" }])).toEqual({
    text: "true",
  });
});
it("explains field errors with business names before submission and clears them after repair", () => {
  const fields = [
    {
      key: "amount",
      label: "报销金额",
      type: "number",
      min: 0,
      max: 100,
      required: true,
    },
    { key: "email", label: "联系邮箱", type: "email" },
    { key: "flag", type: "boolean", required: true },
    { key: "fixed", label: "固定编号", readOnly: true, defaultValue: "001" },
  ];
  const errors = taskFormFieldErrors(fields, {
    amount: 101,
    email: "invalid",
    flag: false,
    fixed: "002",
  });
  expect(errors.amount).toContain("报销金额");
  expect(errors.amount).toContain("最大值");
  expect(errors.email).toContain("联系邮箱");
  expect(errors.fixed).toContain("只读");
  expect(errors.flag).toBeUndefined();
  expect(
    taskFormFieldErrors(fields, {
      amount: 0,
      email: "user@example.com",
      flag: false,
      fixed: "001",
    })
  ).toEqual({});
});
it("rejects unusable or duplicate choices while keeping numeric and text values distinct", () => {
  for (const options of [
    [""],
    [" "],
    ["a", "a"],
    [
      { value: "a", label: "甲" },
      { value: "a", label: "乙" },
    ],
  ]) {
    expect(() =>
      assertTaskFormSchema({
        fields: [{ key: "choice", type: "select", options }],
      })
    ).toThrow();
  }
  expect(() =>
    assertTaskFormSchema({
      fields: [
        {
          key: "tags",
          type: "multiselect",
          options: [1, "1"],
          defaultValue: [1, "1"],
        },
      ],
    })
  ).not.toThrow();
});
it("validates actual calendar dates consistently for defaults and submissions", () => {
  for (const date of [
    "2026-02-30",
    "2025-02-29",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
    "2026/10/03",
    "2026-10-03T12:00:00Z",
  ]) {
    const field = { key: "day", type: "date", required: true };
    expect(() => validateFormSubmission([field], { day: date })).toThrow(
      "日期"
    );
    expect(() =>
      assertTaskFormSchema({
        fields: [{ ...field, readOnly: true, defaultValue: date }],
      })
    ).toThrow("默认值无效");
  }
  for (const day of ["2024-02-29", "2026-10-03", "0001-01-01"]) {
    expect(
      validateFormSubmission([{ key: "day", type: "date" }], { day })
    ).toEqual({ day });
  }
});
it("rejects impossible bounds and unchangeable invalid defaults before publication", () => {
  for (const field of [
    { key: "x", type: "number", min: 10, max: 2 },
    { key: "x", maxLength: -1 },
    { key: "x", maxLength: 1.5 },
    { key: "x", min: "3" },
    { key: "x", type: "number", defaultValue: "0" },
    { key: "x", type: "number", min: 2, defaultValue: 1 },
    { key: "x", required: true, readOnly: true, defaultValue: " " },
    {
      key: "x",
      type: "multiselect",
      options: ["a"],
      required: true,
      readOnly: true,
      defaultValue: [],
    },
    {
      key: "x",
      type: "select",
      options: ["a"],
      readOnly: true,
      defaultValue: "b",
    },
  ])
    expect(() => assertTaskFormSchema({ fields: [field] })).toThrow();
  expect(() =>
    assertTaskFormSchema({
      fields: [
        {
          key: "zero",
          type: "number",
          min: 0,
          max: 0,
          required: true,
          readOnly: true,
          defaultValue: 0,
        },
        {
          key: "flag",
          type: "boolean",
          required: true,
          readOnly: true,
          defaultValue: false,
        },
        { key: "editable", required: true },
      ],
    })
  ).not.toThrow();
});
it("rejects forms that cannot be safely submitted before publishing", () => {
  for (const schema of [
    { fields: {} },
    { fields: [{ key: "decision" }] },
    { fields: [{ key: "x", type: "unknown" }] },
    { fields: [{ key: "x", type: "select", options: [1] }] },
    { fields: [{ key: "x", required: "true" }] },
  ])
    expect(() => assertTaskFormSchema(schema)).toThrow();
  expect(() =>
    assertTaskFormSchema({
      fields: [
        { key: "serial", type: "text" },
        { key: "flag", type: "boolean" },
      ],
    })
  ).not.toThrow();
});
it("keeps numeric-looking and boolean-looking text as strings", () => {
  expect(taskFormInputValue("text", "001")).toBe("001");
  expect(taskFormInputValue("text", "true")).toBe("true");
  expect(taskFormInputValue("select", "001")).toBe("001");
  expect(taskFormInputValue("number", "3.5")).toBe(3.5);
  expect(taskFormInputValue("boolean", "false")).toBe(false);
  expect(taskFormInputValue("multiselect", '["a","b"]')).toEqual(["a", "b"]);
});
it("rejects blank required strings and empty required selections but accepts false and zero", () => {
  expect(() =>
    validateFormSubmission([{ key: "name", required: true }], { name: "   " })
  ).toThrow("必填");
  expect(() =>
    validateFormSubmission(
      [{ key: "choice", type: "multiselect", required: true }],
      { choice: [] }
    )
  ).toThrow("必填");
  expect(
    validateFormSubmission(
      [
        { key: "zero", type: "number", required: true },
        { key: "flag", type: "boolean", required: true },
      ],
      { zero: 0, flag: false }
    )
  ).toEqual({ zero: 0, flag: false });
});
it("enforces read-only values, options and distinct field names", () => {
  expect(() =>
    validateFormSubmission(
      [{ key: "fixed", readOnly: true, defaultValue: "001" }],
      { fixed: "002" }
    )
  ).toThrow("只读");
  expect(() =>
    validateFormSubmission(
      [{ key: "choice", type: "multiselect", options: ["a"] }],
      { choice: ["b"] }
    )
  ).toThrow("选项");
  expect(() =>
    validateFormSubmission([{ key: "x" }, { key: "x" }], { x: "value" })
  ).toThrow("重复");
});
