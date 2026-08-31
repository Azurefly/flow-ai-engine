import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canvasSource = readFileSync(
  new URL("../client/src/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8"
).replace(/\s+/g, " ");

describe("生产画布 profile UI 边界", () => {
  it("公开三类 profile、runtime 和能力说明", () => {
    expect(canvasSource).toContain('getFlowProfile(flowType)');
    expect(canvasSource).toContain('STATE / FSM');
    expect(canvasSource).toContain('CONTROL / ORCHESTRATION');
    expect(canvasSource).toContain('DATA / DAG');
    expect(canvasSource).toContain("运行时：{runtimeLabel}");
    expect(canvasSource).toContain("状态 · 操作 · 路由");
    expect(canvasSource).toContain("服务 · LLM · 条件 · 操作 · 补偿");
    expect(canvasSource).toContain("资源 · SQL · 转换 · 质量 · 审计输出");
  });

  it("把 profile 外节点和实验节点保持为不可添加状态", () => {
    expect(canvasSource).toContain("nodeUnavailableReason(flowType, item.type)");
    expect(canvasSource).toContain("里程碑和数据节点已禁用");
    expect(canvasSource).toContain("状态、SQL 和数据节点已禁用");
    expect(canvasSource).toContain("实验锁定：当前数据运行时尚未开放此节点");
    expect(canvasSource).toContain('disabled');
    expect(canvasSource).toContain('isFlowNodeAllowed(flowType, item.type)');
  });

  it("标明数据安全边界并保留既有 Definition/ReactFlow 语义锚点", () => {
    expect(canvasSource).toContain("audit_only");
    expect(canvasSource).toContain("metadata-safe");
    expect(canvasSource).toContain("不提供字段级血缘，也不模拟真实 Sink 外写");
    expect(canvasSource).toContain("onDefinitionChange");
    expect(canvasSource).toContain("sourceHandle");
    expect(canvasSource).toContain("restoreRouterRouteConfig");
    expect(canvasSource).toContain("ReactFlow<CanvasNode, Edge>");
    expect(canvasSource).toContain("readOnly");
  });
});
