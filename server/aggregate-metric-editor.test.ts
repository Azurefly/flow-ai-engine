import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AggregateMetricEditor } from "../client/src/components/aggregate-metric-editor";
import {
  appendAggregateMetric,
  updateAggregateMetric,
} from "../client/src/components/aggregate-metric-editor-state";
import { validateNodeConfig } from "../shared/workflow-node-contract";

describe("聚合指标表单", () => {
  it("adds valid count metrics without overwriting existing output names", () => {
    const old = [
      { name: "count_1", operation: "count" },
      { name: "count_3", operation: "sum", field: "amount" },
    ];
    const next = appendAggregateMetric(old);
    expect(next[2]).toEqual({ name: "count_2", operation: "count", field: "" });
    expect(old).toHaveLength(2);
    expect(() =>
      validateNodeConfig("aggregate", { groupBy: [], metrics: next })
    ).not.toThrow();
  });
  it("edits the requested metric while preserving imported fields and other metrics", () => {
    const old = [
      {
        name: "total",
        operation: "sum",
        field: "amount",
        extension: { unit: "元" },
      },
      { name: "rows", operation: "count" },
    ];
    const next = updateAggregateMetric(old, 0, { operation: "avg" });
    expect(next[0]).toEqual({ ...old[0], operation: "avg" });
    expect(next[1]).toBe(old[1]);
    expect(old[0].operation).toBe("sum");
  });
  it("renders readable Chinese controls and retains unsupported imported operations for correction", () => {
    const html = renderToStaticMarkup(
      createElement(AggregateMetricEditor, {
        value: [
          { name: "n", operation: "count" },
          { name: "legacy", operation: "median", field: "amount" },
        ],
        disabled: true,
        onChange: () => {},
      })
    );
    expect(html).toContain("字段（可选）");
    expect(html).toContain("数值字段");
    expect(html).toContain("平均值");
    expect(html).toContain("不支持：median");
    expect(html).toContain('disabled=""');
    expect(html).toContain("删除指标 2");
  });
});
