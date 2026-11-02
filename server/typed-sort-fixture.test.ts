import { expect, it } from "vitest";
import { makeTypedSortFixture } from "../scripts/typed-sort-fixture";
import { analyzeWorkflowDefinition } from "./workflow-compiler";
import { sortDataflowRows } from "./dataflow-sort-rows";

it("隔离排序流程为单源六节点双结果，23个样本的独立预期完整且可发布", () => {
  const fixture = makeTypedSortFixture("isolated_asset");
  expect(
    analyzeWorkflowDefinition(fixture.definition, { flowType: "data" }).ok
  ).toBe(true);
  expect(fixture.rows).toHaveLength(23);
  expect(new Set(fixture.rows.map(row => row.id)).size).toBe(23);
  expect(fixture.definition.nodes).toHaveLength(6);
  expect(
    fixture.definition.nodes.filter(node => node.type === "source")
  ).toHaveLength(1);
  for (const [node, result] of [
    ["asc", "ascResult"],
    ["desc", "descResult"],
  ] as const) {
    const config = fixture.definition.nodes.find(
      item => item.id === node
    )!.config;
    expect(sortDataflowRows(fixture.rows, config).map(row => row.id)).toEqual(
      fixture.expected[result]
    );
    expect(new Set(fixture.expected[result]).size).toBe(23);
  }
});

it("隔离定义只引用传入的新样本资产，每次构造不复用可变对象", () => {
  const first = makeTypedSortFixture("asset_a"),
    second = makeTypedSortFixture("asset_b");
  expect(
    first.definition.nodes.find(node => node.type === "source")!.config
  ).toEqual({ assetId: "asset_a", limit: 100 });
  expect(
    second.definition.nodes.find(node => node.type === "source")!.config
  ).toEqual({ assetId: "asset_b", limit: 100 });
  first.rows[0].id = "changed";
  expect(second.rows[0].id).not.toBe("changed");
});
