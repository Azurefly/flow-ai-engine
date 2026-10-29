import { describe, expect, it } from "vitest";
import { readDataflowSortFields } from "../shared/dataflow-sort-config";
import { validateNodeConfig } from "../shared/workflow-node-contract";
import { sortDataflowRows } from "./dataflow-sort-rows";

describe("排序配置与实际执行使用同一合同", () => {
  const rows = [
    { dept: "HR", totalAmount: 120 },
    { dept: "IT", totalAmount: 550 },
  ];

  it("存量 order=desc 与当前 direction=desc 都按汇总额降序，不能默认为升序", () => {
    for (const fields of [
      [{ field: "totalAmount", order: "desc" }],
      [{ field: "totalAmount", direction: "DESC" }],
      [{ field: "totalAmount", direction: "desc", order: "DESC" }],
    ]) {
      expect(() => validateNodeConfig("sort", { fields })).not.toThrow();
      expect(sortDataflowRows(rows, { fields })).toEqual([rows[1], rows[0]]);
    }
  });

  it("确认后的字段名去空格，字符串字段仍默认升序", () => {
    expect(readDataflowSortFields([" totalAmount "])).toEqual([
      { field: "totalAmount", direction: "asc" },
    ]);
    expect(
      sortDataflowRows([...rows].reverse(), { fields: [" totalAmount "] })
    ).toEqual(rows);
    expect(
      sortDataflowRows(rows, {
        fields: [{ field: " totalAmount ", order: "desc" }],
      })
    ).toEqual([rows[1], rows[0]]);
  });

  it("冲突的两个方向在发布与执行时均明确拒绝，不静默选一个", () => {
    const config = {
      fields: [{ field: "totalAmount", direction: "asc", order: "desc" }],
    };
    expect(() => validateNodeConfig("sort", config)).toThrow(
      "direction 与 order 不一致"
    );
    expect(() => sortDataflowRows(rows, config)).toThrow(
      "direction 与 order 不一致"
    );
  });

  it("非法方向或字段不能通过预检后再按升序执行", () => {
    for (const fields of [
      [],
      null,
      [" "],
      [null],
      [[]],
      [1],
      [{}],
      [{ field: "" }],
      [{ field: "totalAmount", direction: "descending" }],
      [{ field: "totalAmount", order: "down" }],
      [{ field: "totalAmount", direction: "asc", order: "wrong" }],
    ]) {
      expect(() => validateNodeConfig("sort", { fields })).toThrow();
      expect(() => sortDataflowRows(rows, { fields })).toThrow();
    }
  });

  it("多字段按优先级排序，同值时保持原顺序，输入和配置不被修改", () => {
    const input = [
      { id: "A", team: "B", amount: 9 },
      { id: "B", team: "A", amount: 1 },
      { id: "C", team: "A", amount: 9 },
      { id: "D", team: "A", amount: 9 },
    ];
    const config = { fields: ["team", { field: "amount", direction: "desc" }] };
    const before = JSON.stringify({ input, config });
    input.forEach(Object.freeze);
    Object.freeze(input);
    const output = sortDataflowRows(input, config);
    expect(output.map(row => row.id)).toEqual(["C", "D", "B", "A"]);
    expect(output[0]).toBe(input[2]);
    expect(JSON.stringify({ input, config })).toBe(before);
  });

  it("null和缺失值视为相等，继续比较次级字段；升序空值在前，降序在后", () => {
    const input = [
      { id: "A", amount: null, rank: 2 },
      { id: "B", rank: 1 },
      { id: "C", amount: 0, rank: 3 },
    ];
    expect(
      sortDataflowRows(input, { fields: ["amount", "rank"] }).map(row => row.id)
    ).toEqual(["B", "A", "C"]);
    expect(
      sortDataflowRows(input, {
        fields: [{ field: "amount", order: "desc" }, "rank"],
      }).map(row => row.id)
    ).toEqual(["C", "B", "A"]);
  });

  it("相同空值保持稳定，文本和数值各自维持原比较方式", () => {
    expect(
      sortDataflowRows([{ x: null, id: 1 }, { id: 2 }], { fields: ["x"] }).map(
        row => row.id
      )
    ).toEqual([1, 2]);
    expect(
      sortDataflowRows([{ x: "b" }, { x: "a" }], { fields: ["x"] })
    ).toEqual([{ x: "a" }, { x: "b" }]);
    expect(
      sortDataflowRows([{ x: 10 }, { x: 2 }, { x: -1 }], { fields: ["x"] })
    ).toEqual([{ x: -1 }, { x: 2 }, { x: 10 }]);
  });

  it("空输入仍校验方向，合法配置返回独立空数组", () => {
    const input: Record<string, unknown>[] = [];
    const output = sortDataflowRows(input, { fields: ["x"] });
    expect(output).toEqual([]);
    expect(output).not.toBe(input);
    expect(() =>
      sortDataflowRows(input, { fields: [{ field: "x", order: "wrong" }] })
    ).toThrow("排序方向");
  });
});
