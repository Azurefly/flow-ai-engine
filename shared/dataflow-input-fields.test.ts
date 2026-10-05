import { expect, it } from "vitest";
import {
  dataflowInputFields as fields,
  dataflowSchemaFields,
  usesDataflowInputFieldSuggestions,
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

it("投影映射只显示输出字段，保留默认源字段名", () => {
  expect(
    fields(
      "lower",
      [
        nodes[0],
        {
          ...nodes[1],
          kind: "project",
          config: {
            fields: [
              { source: "text", target: "renamed" },
              { source: "phone" },
            ],
          },
        },
        nodes[2],
      ],
      edges,
      assets
    )
  ).toEqual(["renamed", "phone"]);
});
it("map列选择不泄露已移除字段", () => {
  expect(
    fields(
      "lower",
      [
        nodes[0],
        { ...nodes[1], kind: "map", config: { columns: ["phone"] } },
        nodes[2],
      ],
      edges,
      assets
    )
  ).toEqual(["phone"]);
});
it("派生字段按运行时名称去空格并保留输入字段", () => {
  expect(
    fields(
      "lower",
      [
        nodes[0],
        {
          ...nodes[1],
          kind: "derive",
          config: {
            fields: [
              { name: " copied ", expression: "{{text}}" },
              { name: "unused", expression: "" },
            ],
          },
        },
        nodes[2],
      ],
      edges,
      assets
    )
  ).toEqual(["text", "phone", "copied"]);
});

const joinNodes = [
  { id: "left", kind: "source", config: { assetId: "leftAsset" } },
  { id: "right", kind: "source", config: { assetId: "rightAsset" } },
  {
    id: "join",
    kind: "join",
    config: { leftInputNodeId: "left", rightInputNodeId: "right" },
  },
  { id: "udf", kind: "udf", config: {} },
];
const joinEdges = [
  { source: "right", target: "join" },
  { source: "left", target: "join" },
  { source: "join", target: "udf" },
];
const joinAssets = [
  { value: "leftAsset", fields: ["id", "text"] },
  { value: "rightAsset", fields: ["id", "text", "phone"] },
];
it("关联按显式左右输入提供同名字段前缀，连线顺序不影响结果", () => {
  expect(fields("udf", joinNodes, joinEdges, joinAssets)).toEqual([
    "id",
    "text",
    "right_id",
    "right_text",
    "phone",
  ]);
  expect(
    fields("udf", joinNodes, [...joinEdges].reverse(), joinAssets)
  ).toEqual(["id", "text", "right_id", "right_text", "phone"]);
});
it("关联自定义前缀与输出冲突时不提供虚假建议", () => {
  const custom = joinNodes.map(node =>
    node.id === "join"
      ? { ...node, config: { ...node.config, rightPrefix: "lookup_" } }
      : node
  );
  expect(fields("udf", custom, joinEdges, joinAssets)).toEqual([
    "id",
    "text",
    "lookup_id",
    "lookup_text",
    "phone",
  ]);
  expect(
    fields("udf", joinNodes, joinEdges, [
      { ...joinAssets[0], fields: ["id", "right_id"] },
      joinAssets[1],
    ])
  ).toEqual([]);
});
it("关联缺少绑定或上游字段不可知时不猜测", () => {
  expect(
    fields(
      "udf",
      joinNodes.map(node =>
        node.id === "join" ? { ...node, config: {} } : node
      ),
      joinEdges,
      joinAssets
    )
  ).toEqual([]);
  expect(fields("udf", joinNodes, joinEdges, [joinAssets[0]])).toEqual([]);
});

it("仅上游输入字段提供建议，不把输入字段误用于输出或常量", () => {
  expect(usesDataflowInputFieldSuggestions("filter", "filterField")).toBe(true);
  expect(usesDataflowInputFieldSuggestions("udf", "inputField")).toBe(true);
  expect(usesDataflowInputFieldSuggestions("filter", "filterValue")).toBe(
    false
  );
  expect(usesDataflowInputFieldSuggestions("udf", "outputField")).toBe(false);
  expect(usesDataflowInputFieldSuggestions("operate", "inputField")).toBe(
    false
  );
});
