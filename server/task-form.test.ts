import { expect, it } from "vitest";
import {
  assertTaskFormSchema,
  taskFormInputValue,
  validateFormSubmission,
} from "../shared/task-form";
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
