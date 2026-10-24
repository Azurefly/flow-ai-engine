import { expect, it } from "vitest";
import { inspectDataflowConfigConversion } from "./dataflow-config-conversion";
import { canApplyDataflowConfigConversion } from "./dataflow-config-conversion-guard";
import { aggregateDataflowRows } from "../server/dataflow-row-operations";
import type { WorkflowDefinition } from "../server/workflow-compiler";
const definition = (): WorkflowDefinition => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: { custom: "retained" },
  nodes: [
    {
      id: "left",
      name: "订单",
      type: "source",
      position: { x: 0, y: 0 },
      config: { assetId: "a" },
    },
    {
      id: "right",
      name: "用户",
      type: "source",
      position: { x: 0, y: 120 },
      config: { assetId: "b" },
    },
    {
      id: "join",
      name: "关联",
      type: "join",
      position: { x: 200, y: 0 },
      config: { leftKeys: ["id"], rightKeys: ["id"], extension: { value: 1 } },
    },
    {
      id: "agg",
      name: "汇总",
      type: "aggregate",
      position: { x: 400, y: 0 },
      config: {
        groupBy: ["dept"],
        metrics: [{ as: "total", op: "sum", field: "amount", unit: "元" }],
      },
    },
  ],
  edges: [
    { id: "e1", sourceNodeId: "left", targetNodeId: "join" },
    { id: "e2", sourceNodeId: "right", targetNodeId: "join" },
  ],
});
it("只生成候选，不修改原定义、旧字段、入边和扩展数据", () => {
  const original = definition(),
    before = JSON.stringify(original),
    plan = inspectDataflowConfigConversion(original);
  expect(JSON.stringify(original)).toBe(before);
  expect(plan.issues).toEqual([]);
  expect(plan.changes).toHaveLength(2);
  expect(plan.candidate?.nodes[2].config).toEqual({
    ...original.nodes[2].config,
    leftInputNodeId: "left",
    rightInputNodeId: "right",
  });
  expect(plan.candidate?.nodes[3].config.metrics).toEqual([
    { name: "total", operation: "sum", field: "amount", unit: "元" },
  ]);
  expect(plan.candidate?.edges).toEqual(original.edges);
  expect(plan.candidate?.settings).toEqual(original.settings);
  expect(inspectDataflowConfigConversion(plan.candidate!).candidate).toBeNull();
});
it.each(["count", "sum", "min", "max", "avg"])(
  "转换明确的%s运算，不把旧op静默退为count",
  operation => {
    const source = definition();
    source.nodes[3].config.metrics = [
      { as: "out", op: operation, field: "amount" },
    ];
    expect(
      (
        inspectDataflowConfigConversion(source).candidate?.nodes[3].config
          .metrics as any[]
      )[0].operation
    ).toBe(operation);
  }
);
it.each([
  { as: "total", op: "median", field: "amount" },
  { as: "total", name: "other", op: "sum", field: "amount" },
  { as: "total", op: "sum", operation: "count", field: "amount" },
  { as: "total", op: "", field: "amount" },
  { as: 7, op: "sum", field: "amount" },
  { as: "total", field: "amount" },
  { as: "dept", op: "sum", field: "amount" },
])("冲突、不完整和不支持配置不能产生可应用候选 %j", metric => {
  const source = definition();
  source.nodes[3].config.metrics = [metric];
  const plan = inspectDataflowConfigConversion(source);
  expect(plan.issues).toHaveLength(1);
  expect(plan.candidate).toBeNull();
});
it("混合当前格式保持语义，重复输出名阻止整份方案应用", () => {
  const source = definition();
  source.nodes[3].config.metrics = [
    { name: "rows", operation: "count" },
    { as: "total", op: "sum", field: "amount" },
  ];
  expect(inspectDataflowConfigConversion(source).issues).toEqual([]);
  (source.nodes[3].config.metrics as any[]).push({
    name: "total",
    operation: "count",
  });
  expect(inspectDataflowConfigConversion(source).candidate).toBeNull();
});
it("关联建议明确反映当前入边顺序；已有绑定不因顺序变化而重写", () => {
  const source = definition();
  source.edges.reverse();
  expect(
    inspectDataflowConfigConversion(source).candidate?.nodes[2].config
      .leftInputNodeId
  ).toBe("right");
  source.nodes[2].config = {
    ...source.nodes[2].config,
    leftInputNodeId: "left",
    rightInputNodeId: "right",
  };
  expect(
    inspectDataflowConfigConversion(source).changes.some(
      change => change.kind === "join"
    )
  ).toBe(false);
});
it.each(["partial", "third", "missing"])(
  "关联%s问题不覆盖用户选择且阻止应用",
  kind => {
    const source = definition();
    if (kind === "partial") source.nodes[2].config.leftInputNodeId = "left";
    if (kind === "third")
      source.edges.push({
        id: "extra",
        sourceNodeId: "agg",
        targetNodeId: "join",
      });
    if (kind === "missing") source.edges[0].sourceNodeId = "removed";
    expect(inspectDataflowConfigConversion(source).candidate).toBeNull();
  }
);
it("应用前必须仍为相同流程、相同填写且可编辑、不在提交中", () => {
  const source = definition(),
    target = { id: "flow", version: 3, definition: source },
    current = {
      id: "flow",
      version: 3,
      definition: structuredClone(source),
      canEdit: true,
      busy: false,
    };
  expect(canApplyDataflowConfigConversion(current, target)).toBe(true);
  for (const patch of [
    { id: "other" },
    { version: 4 },
    { canEdit: false },
    { busy: true },
    { definition: { ...source, settings: { changed: true } } },
  ])
    expect(
      canApplyDataflowConfigConversion({ ...current, ...patch }, target)
    ).toBe(false);
});

it("转换前拒绝旧指标，转换后真实行运算按求和而非计数，空数值和分组遵循当前合同", () => {
  const source = definition();
  const rows = [
    { dept: "销售", amount: 10 },
    { dept: "销售", amount: 25 },
    { dept: "销售", amount: null },
    { dept: "研发", amount: 7 },
  ];
  expect(() => aggregateDataflowRows(rows, source.nodes[3].config)).toThrow();
  const candidate = inspectDataflowConfigConversion(source).candidate!;
  expect(aggregateDataflowRows(rows, candidate.nodes[3].config)).toEqual([
    { dept: "销售", total: 35 },
    { dept: "研发", total: 7 },
  ]);
  expect(source.nodes[3].config.metrics).toEqual([
    { as: "total", op: "sum", field: "amount", unit: "元" },
  ]);
});

it("当前格式的默认计数保持原语义，旧指标缺少计算方式仍阻止转换", () => {
  const source = definition();
  source.nodes[3].config.metrics = [
    { name: "rows" },
    { as: "total", op: "sum", field: "amount" },
  ];
  const candidate = inspectDataflowConfigConversion(source).candidate!;
  expect((candidate.nodes[3].config.metrics as unknown[])[0]).toEqual({
    name: "rows",
  });
  expect(
    aggregateDataflowRows(
      [
        { dept: "销售", amount: 10 },
        { dept: "销售", amount: 25 },
      ],
      candidate.nodes[3].config
    )
  ).toEqual([{ dept: "销售", rows: 2, total: 35 }]);
});
