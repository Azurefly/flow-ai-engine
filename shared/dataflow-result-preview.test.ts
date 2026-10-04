import { expect, it } from "vitest";
import {
  dataflowResultColumns,
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
