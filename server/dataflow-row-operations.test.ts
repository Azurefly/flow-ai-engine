import { describe, expect, it } from "vitest";
import {
  aggregateDataflowRows,
  distinctDataflowRows,
} from "./dataflow-row-operations";
import { validateNodeConfig } from "../shared/workflow-node-contract";

const metrics = [
  { name: "rows", operation: "count" },
  { name: "present", operation: "count", field: "amount" },
  ...["sum", "min", "max", "avg"].map(operation => ({
    name: operation,
    operation,
    field: "amount",
  })),
];

describe("数据流真实行计算", () => {
  it("ignores null values rather than inventing zero in numeric aggregates", () => {
    expect(
      aggregateDataflowRows(
        [{ amount: null }, {}, { amount: 6 }, { amount: "10" }],
        { groupBy: [], metrics }
      )
    ).toEqual([{ rows: 4, present: 2, sum: 16, min: 6, max: 10, avg: 8 }]);
  });
  it("returns a global empty-input summary but does not invent grouped rows", () => {
    expect(aggregateDataflowRows([], { groupBy: [], metrics })).toEqual([
      { rows: 0, present: 0, sum: null, min: null, max: null, avg: null },
    ]);
    expect(aggregateDataflowRows([], { groupBy: ["team"], metrics })).toEqual(
      []
    );
  });
  it("groups missing and null keys together and preserves zero", () => {
    expect(
      aggregateDataflowRows([{ amount: 0 }, { team: null, amount: null }], {
        groupBy: ["team"],
        metrics,
      })
    ).toEqual([
      { team: null, rows: 2, present: 1, sum: 0, min: 0, max: 0, avg: 0 },
    ]);
  });
  it("fails visibly on nonnumeric data and overflow", () => {
    for (const amount of ["", "bad", true, [], Infinity])
      expect(() =>
        aggregateDataflowRows([{ amount }], { groupBy: [], metrics })
      ).toThrow("非数值");
    expect(() =>
      aggregateDataflowRows(
        [{ amount: Number.MAX_VALUE }, { amount: Number.MAX_VALUE }],
        { groupBy: [], metrics }
      )
    ).toThrow("超出数值范围");
  });
  it("rejects empty, unknown, conflicting and fieldless metrics at publish validation", () => {
    for (const invalid of [
      [],
      [{ name: "x", operation: "median", field: "a" }],
      [{ name: "x", operation: "sum" }],
      [{ name: "team", operation: "count" }],
      [{ name: "x" }, { name: "x" }],
    ])
      expect(() =>
        validateNodeConfig("aggregate", { groupBy: ["team"], metrics: invalid })
      ).toThrow();
  });
  it("distinct ignores object field order recursively while preserving array order and value types", () => {
    const first = { a: 1, nested: { x: 2, y: 3 }, list: [1, 2] };
    expect(
      distinctDataflowRows([
        first,
        { list: [1, 2], nested: { y: 3, x: 2 }, a: 1 },
        { ...first, a: "1" },
        { ...first, list: [2, 1] },
      ])
    ).toEqual([first, { ...first, a: "1" }, { ...first, list: [2, 1] }]);
  });
});
