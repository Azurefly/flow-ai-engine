import { expect, it } from "vitest";
import {
  builtinDataFunctionChoice,
  dataFunctionTypeLabel,
} from "./builtin-data-functions";
it("已绑定实现的函数显示处理能力并允许选择", () => {
  expect(
    builtinDataFunctionChoice({
      id: "abcdefgh1234",
      name: "文本清理",
      udfType: "javascript",
      artifactRef: "builtin:trim",
    })
  ).toEqual({
    value: "abcdefgh1234",
    label: "文本清理 · 去除首尾空格（abcdefgh）",
    disabled: false,
  });
});
it.each([
  ["javascript", undefined],
  ["javascript", "unknown"],
  ["python", "builtin:trim"],
])("未配置执行器 %s %s 明确禁用", (udfType, artifactRef) => {
  expect(
    builtinDataFunctionChoice({
      id: "abcdefgh1234",
      name: "待实现",
      udfType,
      artifactRef,
    })
  ).toEqual({
    value: "abcdefgh1234",
    label: "待实现 · 尚不可执行（abcdefgh）",
    disabled: true,
  });
});

it("函数类型明确区分内置执行与仅登记", () => {
  expect(dataFunctionTypeLabel("javascript", "builtin:trim")).toBe(
    "内置文本处理"
  );
  expect(dataFunctionTypeLabel("javascript")).toBe("JavaScript（仅登记）");
  expect(dataFunctionTypeLabel("python", "builtin:trim")).toBe(
    "Python（仅登记）"
  );
});
