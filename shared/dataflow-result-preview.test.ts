import { expect, it } from "vitest";
import {
  dataflowResultColumns,
  dataflowTerminalResults,
  dataflowResultPage,
} from "./dataflow-result-preview";
it("包含后续行字段并保持稳定顺序，不限制前六个字段", () => {
  expect(
    dataflowResultColumns([
      { a: 1 },
      { b: 2, a: 3 },
      { c: 4, d: 5, e: 6, f: 7, g: 8 },
    ])
  ).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  expect(dataflowResultColumns([])).toEqual([]);
});
it("每页十行，分页不丢行并在数据缩短后约束页码", () => {
  const rows = Array.from({ length: 23 }, (_, id) => ({ id }));
  expect(dataflowResultPage(rows, 0).rows).toHaveLength(10);
  expect(dataflowResultPage(rows, 1).rows.map(r => r.id)).toEqual([
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  ]);
  expect(dataflowResultPage(rows, 2)).toMatchObject({
    page: 2,
    pageCount: 3,
    offset: 20,
    rows: [{ id: 20 }, { id: 21 }, { id: 22 }],
  });
  expect(dataflowResultPage(rows.slice(0, 2), 9).page).toBe(0);
  expect(dataflowResultPage([], 0)).toEqual({
    page: 0,
    pageCount: 1,
    offset: 0,
    rows: [],
  });
});

it("保留全部最终结果集及空结果，不展示中间节点输出", () => {
  expect(
    dataflowTerminalResults({
      nodes: [{ output: { rows: [{ debug: true }] } }],
      terminals: [
        { outputName: "订单", rows: [{ id: 1 }] },
        { rows: [] },
        { outputName: "总额", rows: [{ total: 100 }] },
      ],
    })
  ).toEqual([
    { name: "订单", rows: [{ id: 1 }] },
    { name: "结果 2", rows: [] },
    { name: "总额", rows: [{ total: 100 }] },
  ]);
});
it("忽略无最终数据的元信息并兼容原始值行", () => {
  expect(
    dataflowTerminalResults({
      terminals: [null, {}, { rows: [0, false, null] }],
    })
  ).toEqual([
    { name: "结果 3", rows: [{ value: 0 }, { value: false }, { value: null }] },
  ]);
  expect(dataflowTerminalResults({ nodes: [] })).toEqual([]);
});

it("优先显示明确配置的输出名称，并保留节点名称作为回退", () => {
  expect(
    dataflowTerminalResults({
      terminals: [
        {
          outputName: "金额明细",
          nodeName: "金额结果",
          rows: [{ amount: 10 }],
        },
        { nodeName: "业务键结果", rows: [] },
      ],
    }).map(result => result.name)
  ).toEqual(["金额明细", "业务键结果"]);
});
