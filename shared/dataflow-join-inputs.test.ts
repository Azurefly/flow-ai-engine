import { describe, expect, it } from "vitest";
import { resolveDataflowJoinInputs } from "./dataflow-join-inputs";

describe("关联节点输入绑定", () => {
  it("显式左右绑定不受入边顺序影响", () => {
    const config = { leftInputNodeId: "orders", rightInputNodeId: "customers" };
    expect(resolveDataflowJoinInputs(config, ["orders", "customers"])).toEqual([
      "orders",
      "customers",
    ]);
    expect(resolveDataflowJoinInputs(config, ["customers", "orders"])).toEqual([
      "orders",
      "customers",
    ]);
  });
  it("阻止重复、未连接及缺少输入，避免静默丢掉第三个数据集", () => {
    expect(() => resolveDataflowJoinInputs({}, ["a", "b"])).toThrow("必须选择");
    expect(() =>
      resolveDataflowJoinInputs(
        { leftInputNodeId: "a", rightInputNodeId: "a" },
        ["a", "b"]
      )
    ).toThrow("同一个");
    expect(() =>
      resolveDataflowJoinInputs(
        { leftInputNodeId: "a", rightInputNodeId: "c" },
        ["a", "b"]
      )
    ).toThrow("必须分别连接");
    expect(() => resolveDataflowJoinInputs({}, ["a", "b", "c"], true)).toThrow(
      "两个不同"
    );
    expect(() => resolveDataflowJoinInputs({}, ["a", "a"], true)).toThrow(
      "两个不同"
    );
  });
  it("仅历史计划运行允许沿用未配置的旧顺序，部分绑定不能被忽略", () => {
    expect(resolveDataflowJoinInputs({}, ["b", "a"], true)).toEqual(["b", "a"]);
    expect(() =>
      resolveDataflowJoinInputs({ leftInputNodeId: "a" }, ["a", "b"], true)
    ).toThrow("必须选择");
  });
});
