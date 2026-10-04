import { describe, expect, it } from "vitest";
import { joinDataflowRows } from "./dataflow-join-rows";
const config = { kind: "left", leftKeys: ["id"], rightKeys: ["id"] };
describe("数据关联结果", () => {
  it("规范化关联字段名并拒绝空白、重复、异常类型与不等长键", () => {
    expect(
      joinDataflowRows([{ id: 1 }], [{ id: 1 }], {
        ...config,
        leftKeys: [" id "],
      })
    ).toEqual([{ id: 1, right_id: 1 }]);
    for (const leftKeys of [[" "], [1], [{}], ["id", " id "], ["id", "other"]])
      expect(() => joinDataflowRows([], [], { ...config, leftKeys })).toThrow();
  });
  it("空值及缺失键不匹配，左连接补空字段，内连接丢弃未匹配行", () => {
    const left = [{ id: null }, {}, { id: 1 }];
    const right = [
      { id: null, name: "空键" },
      { name: "缺失" },
      { id: 1, name: "有效" },
    ];
    expect(joinDataflowRows(left, right, config)).toEqual([
      { id: null, right_id: null, name: null },
      { right_id: null, name: null },
      { id: 1, right_id: 1, name: "有效" },
    ]);
    expect(joinDataflowRows(left, right, { ...config, kind: "inner" })).toEqual(
      [{ id: 1, right_id: 1, name: "有效" }]
    );
  });
  it("多键重复匹配保持全部组合，并区分数值和文本键", () => {
    expect(
      joinDataflowRows(
        [
          { id: 1, part: 0 },
          { id: "1", part: 0 },
        ],
        [
          { id: 1, part: 0, value: "a" },
          { id: 1, part: 0, value: "b" },
        ],
        { ...config, leftKeys: ["id", "part"], rightKeys: ["id", "part"] }
      )
    ).toEqual([
      { id: 1, part: 0, right_id: 1, right_part: 0, value: "a" },
      { id: 1, part: 0, right_id: 1, right_part: 0, value: "b" },
      { id: "1", part: 0, right_id: null, right_part: null, value: null },
    ]);
  });
  it("统一稀疏行输出名称，禁止前缀覆盖左右已有字段", () => {
    expect(
      joinDataflowRows(
        [{ id: 1 }, { id: 2, name: "左" }],
        [{ id: 1, name: "右" }],
        config
      )[0]
    ).toEqual({ id: 1, right_id: 1, right_name: "右" });
    expect(() =>
      joinDataflowRows([{ id: 1, right_id: "保留" }], [{ id: 1 }], config)
    ).toThrow("重名");
    expect(() =>
      joinDataflowRows([{ id: 1 }], [{ id: 1, right_id: 2 }], config)
    ).toThrow("重名");
    expect(
      joinDataflowRows([{ id: 1, right_id: "保留" }], [{ id: 1 }], {
        ...config,
        rightPrefix: "客户_",
      })
    ).toEqual([{ id: 1, right_id: "保留", 客户_id: 1 }]);
  });
  it("匹配及未匹配结果都遵守行数上限", () => {
    expect(() =>
      joinDataflowRows([{ id: 1 }], [{ id: 1 }, { id: 1 }], config, 1)
    ).toThrow("执行上限");
    expect(() =>
      joinDataflowRows([{ id: 1 }, { id: 2 }], [], config, 1)
    ).toThrow("执行上限");
  });
});

it("对象关联键忽略嵌套属性顺序，但保持数组顺序与值类型", () => {
  const left = [{ id: { a: 1, b: { x: 2, y: [1, "2"] } } }];
  const right = [
    { id: { b: { y: [1, "2"], x: 2 }, a: 1 }, label: "matched" },
    { id: { a: 1, b: { x: 2, y: ["2", 1] } }, label: "wrong-order" },
    { id: { a: 1, b: { x: 2, y: [1, 2] } }, label: "wrong-type" },
  ];
  expect(joinDataflowRows(left, right, { ...config, kind: "inner" })).toEqual([
    { ...left[0], right_id: right[0].id, label: "matched" },
  ]);
});
