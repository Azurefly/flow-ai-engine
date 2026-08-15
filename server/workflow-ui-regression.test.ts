import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../client/src/components/WorkflowCanvas.tsx", import.meta.url), "utf8");
const governanceSource = readFileSync(new URL("../client/src/components/WorkflowGovernance.tsx", import.meta.url), "utf8");
const runCenterSource = readFileSync(new URL("../client/src/components/RunCenter.tsx", import.meta.url), "utf8");

describe("流程设计器界面回归约束", () => {
  it("新建流程按钮提交表单，控制台壳层可在窄屏纵向收敛", () => {
    expect(homeSource).toContain('<Button type="submit" size="sm" className="h-8"');
    expect(homeSource).toContain('flex min-h-[calc(100vh-56px)] flex-col md:flex-row');
    expect(homeSource).toContain('sidebarOpen ? "w-full md:w-72"');
  });

  it("画布与节点检查器在窄屏纵向堆叠，并在大屏恢复双列", () => {
    expect(canvasSource).toContain('grid-cols-1');
    expect(canvasSource).toContain('lg:grid-cols-[minmax(0,1fr)_320px]');
    expect(canvasSource).toContain('border-t border-slate-200 bg-white p-4 lg:border-l lg:border-t-0');
  });

  it("保留版本差异与可审计回滚入口", () => {
    expect(governanceSource).toContain("workflow.versionDiff.useQuery");
    expect(governanceSource).toContain("workflow.rollbackVersion.useMutation");
    expect(governanceSource).toContain("恢复此版本");
  });

  it("保留运行筛选、耗时统计、失败告警和个人复用资产入口", () => {
    expect(runCenterSource).toContain("workflow.runMetrics.useQuery");
    expect(runCenterSource).toContain("按运行状态筛选");
    expect(runCenterSource).toContain("失败告警");
    expect(canvasSource).toContain("REUSE LIBRARY");
    expect(canvasSource).toContain("保存为节点模板");
    expect(canvasSource).toContain("模板 JSON 配置");
    expect(homeSource).toContain("保存当前定义为子流程");
  });

  it("新增治理、运行分析与复用资产面板在窄屏保持可访问结构", () => {
    expect(governanceSource).toContain("flex flex-col gap-3");
    expect(governanceSource).toContain("xl:grid-cols-[260px_1fr]");
    expect(runCenterSource).toContain("flex flex-wrap items-center gap-2");
    expect(runCenterSource).toContain("sm:grid-cols-2 xl:grid-cols-5");
    expect(canvasSource).toContain("overflow-x-auto border-b");
  });
});
