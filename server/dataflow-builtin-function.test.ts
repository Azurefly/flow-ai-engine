import { expect, it } from "vitest";
import { executeBuiltinDataFunction as execute } from "./dataflow-builtin-function";
it.each([
  ["trim", " 甲 ", "甲"],
  ["lower", "ABC", "abc"],
  ["upper", "abc", "ABC"],
  ["mask-phone", "13812345678", "138****5678"],
])("实际执行 %s 且不改变输入数据", (name, input, expected) => {
  const rows = [{ value: input, keep: 0 }];
  expect(execute(rows, `builtin:${name}`, "value", "result")).toEqual([
    { value: input, keep: 0, result: expected },
  ]);
  expect(rows).toEqual([{ value: input, keep: 0 }]);
});
it("保留 null，支持显式覆盖原字段", () =>
  expect(
    execute(
      [{ value: null }, { value: " a " }],
      "builtin:trim",
      "value",
      "value"
    )
  ).toEqual([{ value: null }, { value: "a" }]));
it("未实现函数、缺失字段及错误类型不能假成功", () => {
  expect(() => execute([], "unknown", "value", "result")).toThrow(
    "尚无可执行实现"
  );
  expect(() => execute([{}], "builtin:trim", "value", "result")).toThrow(
    "缺少输入字段"
  );
  expect(() =>
    execute([{ value: 1 }], "builtin:trim", "value", "result")
  ).toThrow("必须为文本");
  expect(() =>
    execute([{ value: "123" }], "builtin:mask-phone", "value", "result")
  ).toThrow("11位");
  expect(() => execute([], "builtin:trim", "value", "__proto__")).toThrow(
    "有效的输入与输出字段"
  );
});
