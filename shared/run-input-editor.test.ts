import { expect, it } from "vitest";
import { readRunInputRows, runInputRowsFromValue } from "./run-input-editor";
it("新增空行不会造成输入错误或伪字段", () =>
  expect(readRunInputRows([{ key: "", value: "" }])).toEqual({
    input: {},
    errors: [],
  }));
it("自动识别保护前导零和超大业务编号", () => {
  expect(
    readRunInputRows([
      { key: "id", value: "00123" },
      { key: "large", value: "9007199254740993" },
    ]).input
  ).toEqual({ id: "00123", large: "9007199254740993" });
});
it("文本类型不把数字或布尔字面量转换", () => {
  expect(
    readRunInputRows([
      { key: "id", value: "00123", kind: "text" },
      { key: "flag", value: "true", kind: "text" },
    ]).input
  ).toEqual({ id: "00123", flag: "true" });
});
it.each(["0", "42", "-1", "1.5", "1e3"])("数值类型允许合法值 %s", value => {
  const result = readRunInputRows([{ key: "amount", value, kind: "number" }]);
  expect(result.errors).toEqual([]);
  expect(result.input.amount).toBe(Number(value));
});
it.each(["", "00123", "Infinity", "9007199254740993"])(
  "数值类型拒绝不可靠值 %s",
  value =>
    expect(
      readRunInputRows([{ key: "id", value, kind: "number" }]).errors
    ).toHaveLength(1)
);
it("布尔和 JSON 支持明确类型", () => {
  expect(
    readRunInputRows([
      { key: "flag", value: "false", kind: "boolean" },
      { key: "config", value: '{"items":[0,true,null]}', kind: "json" },
    ]).input
  ).toEqual({ flag: false, config: { items: [0, true, null] } });
});
it.each(["{bad}", '{"id":9007199254740993}'])(
  "拒绝无效或不安全 JSON %s",
  value =>
    expect(
      readRunInputRows([{ key: "config", value, kind: "json" }]).errors
    ).toHaveLength(1)
);
it("重复字段不会静默覆盖", () => {
  const result = readRunInputRows([
    { key: "id", value: "00123", kind: "text" },
    { key: " id ", value: "other", kind: "text" },
  ]);
  expect(result.input).toEqual({ id: "00123" });
  expect(result.errors[0]).toContain("重复");
});
it("有值而无字段名时提示错误", () =>
  expect(readRunInputRows([{ key: "", value: "42" }]).errors[0]).toContain(
    "填写字段名"
  ));
it("已有输入回填时保留真实类型", () => {
  const original = {
    id: "00123",
    amount: 0,
    flag: false,
    config: { active: true },
    empty: null,
  };
  const rows = runInputRowsFromValue(original);
  expect(rows.map(row => row.kind)).toEqual([
    "text",
    "number",
    "boolean",
    "json",
    "json",
  ]);
  expect(readRunInputRows(rows)).toEqual({ input: original, errors: [] });
});
it("特殊字段名作为普通自有属性保存", () => {
  const result = readRunInputRows([
    { key: "__proto__", value: '{"marker":true}', kind: "json" },
  ]);
  expect(Object.getPrototypeOf(result.input)).toBe(Object.prototype);
  expect(Object.hasOwn(result.input, "__proto__")).toBe(true);
  expect(({} as any).marker).toBeUndefined();
});
