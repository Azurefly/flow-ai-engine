import { expect, it } from "vitest";
import { validateNodeConfig } from "../shared/workflow-node-contract";
it.each([1.5, -1, 1000001, NaN, Infinity, null, "", "1", false, {}])(
  "质量门预检拒绝无效最少行数 %s",
  minRows => {
    expect(() =>
      validateNodeConfig("quality_gate", { minRows, maxNullRate: 1 })
    ).toThrow("最少行数");
  }
);
it.each([-0.1, 1.1, NaN, Infinity, null, "", "0.5", false, {}])(
  "质量门预检拒绝无效空值率 %s",
  maxNullRate => {
    expect(() =>
      validateNodeConfig("quality_gate", { minRows: 1, maxNullRate })
    ).toThrow("空值率");
  }
);
it.each([
  { minRows: 0, maxNullRate: 0 },
  { minRows: 1000000, maxNullRate: 1 },
  { minRows: 1, maxNullRate: 0.05 },
  {},
])("质量门预检允许合法配置和默认值 %s", config => {
  expect(() => validateNodeConfig("quality_gate", config)).not.toThrow();
});
