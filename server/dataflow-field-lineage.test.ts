import { expect, it } from "vitest";
import { dataflowInputFields } from "../shared/dataflow-input-fields";
import { readDataflowFieldNames } from "../shared/dataflow-field-list";
import { aggregateDataflowRows } from "./dataflow-row-operations";
import { joinDataflowRows } from "./dataflow-join-rows";

const source = { id: "source", kind: "source", config: { assetId: "asset" } };
const filter = { id: "filter", kind: "filter", config: {} };
const edge = { source: "source", target: "filter" };
const assets = [{ value: "asset", fields: ["id", "amount", "status"] }];

it("读取列建议与连接器使用的 columns 合同一致，包含去空格后的顺序", () => {
  const config = { ...source.config, columns: [" amount ", "id"] };
  expect(dataflowInputFields("filter", [{ ...source, config }, filter], [edge], assets))
    .toEqual(readDataflowFieldNames(config.columns, "读取字段"));
});

it("留空读取全部字段，运行时忽略的旧 fields 不应截断建议", () => {
  for (const columns of [undefined, []])
    expect(dataflowInputFields("filter", [
      { ...source, config: { ...source.config, columns, fields: ["id"] } }, filter,
    ], [edge], assets)).toEqual(assets[0].fields);
});

it("非法读取列不回退到全部元数据，避免掩盖配置错误", () => {
  for (const columns of [null, "id", [""], [2], ["id", " id "]])
    expect(dataflowInputFields("filter", [
      { ...source, config: { ...source.config, columns } }, filter,
    ], [edge], assets)).toEqual([]);
});

it("列裁剪改变关联冲突命名，下游建议应与真实关联输出一致", () => {
  const right = { id: "right", kind: "source", config: { assetId: "rightAsset" } };
  const join = { id: "join", kind: "join", config: {
    leftInputNodeId: "source", rightInputNodeId: "right",
    rightPrefix: "lookup_", leftKeys: ["id"], rightKeys: ["id"], kind: "inner",
  } };
  const left = { ...source, config: { ...source.config, columns: ["id"] } };
  const rows = joinDataflowRows([{ id: 1 }], [{ id: 1, text: "A" }], join.config);
  const suggestions = dataflowInputFields("filter", [left, right, join, filter], [
    { source: "right", target: "join" },
    { source: "source", target: "join" },
    { source: "join", target: "filter" },
  ], [...assets, { value: "rightAsset", fields: ["id", "text"] }]);
  expect(suggestions).toEqual(Object.keys(rows[0]));
  expect(suggestions).toEqual(["id", "lookup_id", "text"]);
});

const aggregate = { id: "aggregate", kind: "aggregate", config: {
  groupBy: [" team "], metrics: [
    { name: "total", operation: "sum", field: "amount" },
    { name: "present", operation: "count", field: "amount" },
  ],
} };
const aggregateEdges = [
  { source: "source", target: "aggregate" },
  { source: "aggregate", target: "filter" },
];

it("聚合建议与真实零值/空值样本输出一致，不再暴露明细列", () => {
  const output = aggregateDataflowRows([
    { team: "A", amount: 0, status: "paid" },
    { team: "A", amount: "12", status: "paid" },
    { team: "A", amount: null, status: "paid" },
  ], aggregate.config);
  expect(output).toEqual([{ team: "A", total: 12, present: 2 }]);
  expect(dataflowInputFields("filter", [source, aggregate, filter], aggregateEdges, assets))
    .toEqual(Object.keys(output[0]));
});

it("确定的聚合输出不依赖上游样本字段，仍可传给后续函数", () => {
  const udf = { ...filter, kind: "udf" };
  expect(dataflowInputFields("filter", [source, aggregate, udf], aggregateEdges, []))
    .toEqual(["team", "total", "present"]);
});

it("聚合无效或旧别名未确认时不虚构输出指标", () => {
  for (const config of [
    { ...aggregate.config, metrics: [{ as: "total", op: "sum", field: "amount" }] },
    { ...aggregate.config, metrics: [{ name: "team", operation: "count" }] },
    { ...aggregate.config, metrics: [] },
  ])
    expect(dataflowInputFields("filter", [source, { ...aggregate, config }, filter], aggregateEdges, assets))
      .toEqual([]);
});
