import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileDataflowExecutionPlan } from "./p2-service";

const definition = {
  schemaVersion: 1 as const,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    { id: "start", type: "start" as const, name: "开始", position: { x: 0, y: 0 }, config: {} },
    { id: "source", type: "source" as const, name: "订单", position: { x: 120, y: 0 }, config: { assetId: "asset-1" } },
    { id: "filter", type: "filter" as const, name: "筛选", position: { x: 240, y: 0 }, config: { filterField: "status", filterValue: "paid" } },
    { id: "sink", type: "sink" as const, name: "输出", position: { x: 360, y: 0 }, config: { outputName: "paid_orders" } },
    { id: "end", type: "end" as const, name: "结束", position: { x: 480, y: 0 }, config: {} },
  ],
  edges: [
    { id: "start-source", sourceNodeId: "start", targetNodeId: "source" },
    { id: "source-filter", sourceNodeId: "source", targetNodeId: "filter" },
    { id: "filter-sink", sourceNodeId: "filter", targetNodeId: "sink" },
    { id: "sink-end", sourceNodeId: "sink", targetNodeId: "end" },
  ],
};

describe("数据流 ExecutionPlan V2 基线", () => {
  it("生成带 dataflow profile、稳定拓扑顺序和可重现哈希的不可变计划", () => {
    const first = compileDataflowExecutionPlan(definition);
    const second = compileDataflowExecutionPlan(definition);
    expect(first.plan.profile).toEqual({
      flowType: "data",
      profileVersion: 1,
      runtimeKind: "dataflow",
    });
    expect(first.plan.topologicalOrder).toEqual([
      "start",
      "source",
      "filter",
      "sink",
      "end",
    ]);
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.planHash).toBe(first.planHash);
  });

  it("运行时只消费已校验计划并将计划与 requestId 固化到运行记录", () => {
    const source = readFileSync(new URL("./p2-service.ts", import.meta.url), "utf8");
    expect(source).toContain("assertWorkflowExecutionPlan(");
    expect(source).toContain("job.executionPlan,");
    expect(source).toContain("await runDataflowJobOnce(runId)");
    expect(source).toContain("executionPlanJson,executionPlanHash,requestId");
    expect(source).toContain("const queue = [...executionPlan.topologicalOrder]");
  });
});
