import { expect, it } from "vitest";
import {
  taskAdditionalFieldError,
  taskFormRowValues,
} from "../shared/task-form";

const fields = [
  { key: "amount", type: "number" },
  { key: "serial", readOnly: true, defaultValue: "FORM-01" },
];

it("允许独立补充字段和完全空白行，不修改原字段或输入", () => {
  const rows = [
    { key: "", value: "" },
    { key: " extra ", value: "001" },
  ];
  const before = JSON.stringify({ fields, rows });
  expect(taskAdditionalFieldError(fields, rows)).toBeNull();
  expect(JSON.stringify({ fields, rows })).toBe(before);
});

it.each([
  "amount",
  "serial",
  "decision",
  "outcome",
  "comment",
  "__proto__",
  "constructor",
  "prototype",
])("阻止补充字段占用已有或保留名称 %s", key => {
  expect(
    taskAdditionalFieldError(fields, [{ key: ` ${key} `, value: "bad" }])
  ).toEqual({
    index: 0,
    message: `字段“${key}”已被占用，请更换补充字段名称。`,
  });
});

it("报告实际冲突行索引，名称修复后可继续提交", () => {
  const rows = [
    { key: "extra", value: "a" },
    { key: " extra ", value: "b" },
  ];
  expect(taskAdditionalFieldError(fields, rows)?.index).toBe(1);
  rows[1].key = "second";
  expect(taskAdditionalFieldError(fields, rows)).toBeNull();
  expect(
    taskFormRowValues(fields, [
      { key: "amount", value: "50" },
      { key: "serial", value: "FORM-01" },
      ...rows,
    ])
  ).toEqual({ amount: 50, serial: "FORM-01", extra: "a", second: "b" });
});

it("保留无名称的未提交输入并给出可修正错误", () => {
  const rows = [
    { key: "first", value: "a" },
    { key: " ", value: "用户填写" },
  ];
  expect(taskAdditionalFieldError(fields, rows)).toEqual({
    index: 1,
    message: "请填写补充字段名称。",
  });
  expect(rows[1].value).toBe("用户填写");
});
