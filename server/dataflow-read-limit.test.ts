import { describe, expect, it } from "vitest";
import { dataflowReadLimit } from "../shared/dataflow-read-limit";
import {
  createDefaultNodeConfig,
  validateNodeConfig,
} from "../shared/workflow-node-contract";

describe("数据读取行数", () => {
  it("使用明确默认值，并保留边界整数", () => {
    expect(dataflowReadLimit(undefined, 200)).toBe(200);
    expect(dataflowReadLimit(null, 1000)).toBe(1000);
    expect(dataflowReadLimit(1, 200)).toBe(1);
    expect(dataflowReadLimit(1000, 200)).toBe(1000);
  });
  it("拒绝无效读取量，不隐式取整或截断", () => {
    for (const value of [0, -1, 1.5, 1001, Infinity, NaN, "10", true])
      expect(() => dataflowReadLimit(value, 200)).toThrow("整数");
  });
  it("四种读取节点在发布前应用相同校验", () => {
    for (const kind of ["source", "table", "sql", "edit_sql"] as const) {
      const config = {
        ...createDefaultNodeConfig(kind),
        assetId: "asset",
        datasourceId: "source",
      };
      expect(() => validateNodeConfig(kind, config)).not.toThrow();
      const key = kind === "source" || kind === "table" ? "limit" : "maxRows";
      expect(() =>
        validateNodeConfig(kind, { ...config, [key]: 1001 })
      ).toThrow("整数");
    }
    expect(() =>
      validateNodeConfig("source", { assetId: "asset", columns: [""] })
    ).toThrow("空白项");
    expect(() =>
      validateNodeConfig("source", { assetId: "asset", columns: [1] })
    ).toThrow("非文本");
    expect(() =>
      validateNodeConfig("source", {
        assetId: "asset",
        columns: ["id", " id "],
      })
    ).toThrow("重复");
  });
});
