import { expect, it } from "vitest";
import { maxDataflowDatasetRows, normalizeRows } from "./dataflow-dataset-rows";

it("execution keeps every row while an explicit preview limit returns only samples", () => {
  const rows = Array.from({ length: 500 }, (_, n) => ({
    n,
    nested: { value: n },
  }));
  expect(normalizeRows(rows)).toHaveLength(500);
  expect(normalizeRows({ rows })).toHaveLength(500);
  expect(normalizeRows(rows, 20)).toHaveLength(20);
  expect(normalizeRows(rows).at(-1)).toEqual(rows.at(-1));
  const cloned = normalizeRows(rows);
  (cloned[0].nested as any).value = -1;
  expect(rows[0].nested.value).toBe(0);
});
it("fails rather than silently truncating a dataset beyond the execution bound", () => {
  const rows = Array.from({ length: maxDataflowDatasetRows + 1 }, () => ({}));
  expect(() => normalizeRows(rows)).toThrow("不会截断");
  expect(normalizeRows(rows, 20)).toHaveLength(20);
  expect(normalizeRows(undefined)).toEqual([]);
});
