import { expect, it } from "vitest";
import {
  dataflowInputFields as fields,
  dataflowSchemaFields,
} from "./dataflow-input-fields";
const nodes = [
  { id: "source", kind: "source", config: { assetId: "asset" } },
  { id: "trim", kind: "udf", config: { outputField: "trimmed" } },
  { id: "lower", kind: "udf", config: {} },
];
const edges = [
  { source: "source", target: "trim" },
  { source: "trim", target: "lower" },
];
const assets = [{ value: "asset", fields: ["text", "phone"] }];
it("从资源字段和上游函数输出提供输入字段建议", () =>
  expect(fields("lower", nodes, edges, assets)).toEqual([
    "text",
    "phone",
    "trimmed",
  ]));
it("资源读取字段限制会同步影响建议", () =>
  expect(
    fields(
      "trim",
      [
        { ...nodes[0], config: { assetId: "asset", fields: ["text"] } },
        nodes[1],
      ],
      edges,
      assets
    )
  ).toEqual(["text"]));
it("未知转换、多路输入和循环不猜测字段", () => {
  expect(
    fields(
      "lower",
      [nodes[0], { ...nodes[1], kind: "join" }, nodes[2]],
      edges,
      assets
    )
  ).toEqual([]);
  expect(
    fields(
      "lower",
      nodes,
      [...edges, { source: "source", target: "lower" }],
      assets
    )
  ).toEqual([]);
  expect(
    fields(
      "lower",
      nodes,
      [{ source: "lower", target: "trim" }, edges[1]],
      assets
    )
  ).toEqual([]);
});
it("元数据字段去重并限制100项", () => {
  expect(
    dataflowSchemaFields([
      { name: "text" },
      { name: "text" },
      { name: 2 },
      null,
    ])
  ).toEqual(["text"]);
  expect(
    dataflowSchemaFields(
      Array.from({ length: 101 }, (_, i) => ({ name: String(i) }))
    ).length
  ).toBe(100);
});
