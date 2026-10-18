import { expect, it } from "vitest";
import {
  nodeNumberDraftError,
  parseNodeNumberDraft,
  stepNodeNumberDraft,
} from "./node-number-input";
import {
  createDefaultNodeConfig,
  validateNodeConfig,
} from "./workflow-node-contract";

it.each([
  ["0.05", 0.05],
  [".5", 0.5],
  ["-1.2", -1.2],
  ["1e3", 1000],
  ["2.5e-3", 0.0025],
  ["", ""],
  ["  ", ""],
])("完整数值 %s 转为正确的配置类型", (raw, value) => {
  expect(parseNodeNumberDraft(String(raw))).toBe(value);
});
it.each([
  "-",
  ".",
  "1.",
  "1e",
  "1e-",
  "1e+",
  "Infinity",
  "NaN",
  "1e999",
  "0x10",
  "1,000",
])("未完成或非法数值 %s 保留原始文本，不回退旧值", raw => {
  expect(parseNodeNumberDraft(raw)).toBe(raw);
  expect(() =>
    validateNodeConfig("quality_gate", {
      minRows: 1,
      maxNullRate: parseNodeNumberDraft(raw),
    })
  ).toThrow("空值率");
});
it("范围与整数提示和现有数值契约一致", () => {
  const field = {
    label: "等待时长",
    required: true,
    min: 1,
    max: 100,
    step: 1,
  };
  expect(nodeNumberDraftError(field, "")).toContain("不能为空");
  expect(nodeNumberDraftError(field, "2.5")).toContain("整数");
  expect(nodeNumberDraftError(field, "0")).toContain("1 至 100");
  expect(nodeNumberDraftError(field, "2")).toBeNull();
  expect(
    nodeNumberDraftError(
      { label: "空值率", min: 0, max: 1, step: "any" },
      "0.05"
    )
  ).toBeNull();
});
it("键盘上下键保留小数精度，并受数值上下限约束", () => {
  const rate = { label: "空值率", min: 0, max: 1, step: "any" as const };
  expect(stepNodeNumberDraft("0.05", 1, rate)).toBe("0.06");
  expect(stepNodeNumberDraft("0.3", -1, rate)).toBe("0.29");
  expect(stepNodeNumberDraft("1", 1, rate)).toBe("1");
  expect(stepNodeNumberDraft("0", -1, rate)).toBe("0");
  expect(stepNodeNumberDraft("", 1, { label: "等待", min: 1, step: 1 })).toBe(
    "2"
  );
  expect(stepNodeNumberDraft("1.5", 1, { label: "数值" })).toBe("2.5");
  expect(stepNodeNumberDraft("1e-7", 1, { label: "数值" })).toBe("1.0000001");
  expect(
    stepNodeNumberDraft("1000.5", 1, {
      label: "超时",
      min: 1000,
      max: 15000,
      step: "any",
    })
  ).toBe("1001.5");
});
it.each(["wait", "quality_gate"] as const)(
  "%s 的显式清空不可被当作默认值保存",
  kind => {
    const config = createDefaultNodeConfig(kind);
    const key = kind === "wait" ? "durationSeconds" : "maxNullRate";
    expect(() => validateNodeConfig(kind, { ...config, [key]: "" })).toThrow();
    expect(() =>
      validateNodeConfig(kind, { ...config, [key]: null })
    ).toThrow();
  }
);
it("规范字段拒绝未完成文本，同时不修改兼容字段与原配置", () => {
  const config = {
    ...createDefaultNodeConfig("operate"),
    dueAfterSeconds: "1e-",
    opaque: { keep: true },
  };
  const before = structuredClone(config);
  expect(() => validateNodeConfig("operate", config)).toThrow("办理时限");
  expect(config).toEqual(before);
});
