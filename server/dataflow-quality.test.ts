import { expect, it } from "vitest";
import { checkDataflowQuality } from "./dataflow-quality";
it("稀疏字段按整个数据集的字段集合计入缺失单元格", () => {
  const rows = [{ name: "甲" }, { amount: 10 }];
  expect(() => checkDataflowQuality(rows, 1, 0.25)).toThrow(
    "空值率 0.5000/0.25"
  );
  expect(checkDataflowQuality(rows, 1, 0.5).nullRate).toBe(0.5);
});
it("零与否不作为空值，空字符串和缺失字段计为空值", () => {
  expect(
    checkDataflowQuality(
      [
        { a: 0, b: false },
        { a: "", b: null },
      ],
      1,
      1
    ).nullRate
  ).toBe(0.5);
});
it("没有字段的数据行拒绝通过质量门", () => {
  expect(() => checkDataflowQuality([{}, {}], 1, 1)).toThrow("没有可用字段");
});
it("空数据集仍受最少行数约束", () => {
  expect(() => checkDataflowQuality([], 1, 1)).toThrow("行数 0/1");
  expect(checkDataflowQuality([], 0, 0)).toEqual({
    passed: true,
    rowCount: 0,
    nullRate: 0,
  });
});

it.each([
  NaN,
  Infinity,
  -1,
  1.5,
  Number.MAX_SAFE_INTEGER + 1,
  "abc",
  "",
  false,
  {},
  null,
])("拒绝无效最少行数 %s", value => {
  expect(() => checkDataflowQuality([{ a: 1 }], value, 1)).toThrow("最少行数");
});
it.each([NaN, Infinity, -0.1, 1.1, "abc", "", false, {}, null])(
  "拒绝无效空值率 %s",
  value => {
    expect(() => checkDataflowQuality([{ a: 1 }], 0, value)).toThrow(
      "最大空值率"
    );
  }
);
it("兼容明确的数字字符串并保留边界值", () => {
  expect(checkDataflowQuality([{ a: null }], "1", "1").passed).toBe(true);
  expect(checkDataflowQuality([{ a: 0 }], "0", "0").nullRate).toBe(0);
});
