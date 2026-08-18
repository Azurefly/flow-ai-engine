import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../client/src/components/WorkflowCanvas.tsx", import.meta.url), "utf8");
const nodeContractSource = readFileSync(new URL("../shared/workflow-node-contract.ts", import.meta.url), "utf8");
const governanceSource = readFileSync(new URL("../client/src/components/WorkflowGovernance.tsx", import.meta.url), "utf8");
const runCenterSource = readFileSync(new URL("../client/src/components/RunCenter.tsx", import.meta.url), "utf8");
const projectWorkspaceSource = readFileSync(new URL("../client/src/components/ProjectWorkspace.tsx", import.meta.url), "utf8");
const warehouseSource = readFileSync(new URL("../client/src/components/WorkflowWarehouse.tsx", import.meta.url), "utf8");
const systemConfigSource = readFileSync(new URL("../client/src/components/SystemConfigShell.tsx", import.meta.url), "utf8");

describe("流程设计器界面回归约束", () => {
  it("新建流程按钮提交表单，控制台壳层可在窄屏纵向收敛", () => {
    expect(homeSource).toContain('<Button type="submit" size="sm" className="h-8"');
    expect(homeSource).toContain('flex min-h-[calc(100vh-56px)] flex-col md:flex-row');
    expect(homeSource).toContain('sidebarOpen ? "w-full md:w-72"');
  });

  it("画布与节点检查器在窄屏纵向堆叠，并在大屏恢复双列", () => {
    expect(canvasSource).toContain('grid-cols-1');
    expect(canvasSource).toContain('lg:grid-cols-[minmax(0,1fr)_320px]');
    expect(canvasSource).toContain('border-t border-slate-200 bg-white lg:border-l lg:border-t-0');
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

  it("保留原始四页签、项目工作区和独立系统配置入口", () => {
    expect(homeSource).toContain('label: "已启动流程"');
    expect(homeSource).toContain('label: "流程仓库"');
    expect(homeSource).toContain('label: "系统配置"');
    expect(projectWorkspaceSource).toContain("PROCESS DESIGN CENTER");
    expect(projectWorkspaceSource).toContain("状态流程");
    expect(projectWorkspaceSource).toContain("控制流程");
    expect(projectWorkspaceSource).toContain("数据流程");
    expect(systemConfigSource).toContain("APPROVAL CONFIGURATION");
    expect(systemConfigSource).toContain("WORK DOMAIN");
  });

  it("保留树形仓库、只读画布预览、批量 JSON 导出和原始流程节点分类", () => {
    expect(warehouseSource).toContain("PROCESS WAREHOUSE");
    expect(warehouseSource).toContain("批量导出");
    expect(warehouseSource).toContain("WorkflowCanvas");
    expect(warehouseSource).toContain("FolderTree");
    expect(nodeContractSource).toContain('type: "state"');
    expect(nodeContractSource).toContain('type: "operate"');
    expect(nodeContractSource).toContain('type: "router"');
    expect(nodeContractSource).toContain('type: "rest"');
    expect(nodeContractSource).toContain('type: "form"');
    expect(nodeContractSource).toContain('type: "sql"');
  });

  it("恢复安装包设计器的画布工具、配置状态、帮助提示与字段化配置面板", () => {
    expect(canvasSource).toContain("整理画布");
    expect(canvasSource).toContain("保存为图片");
    expect(canvasSource).toContain("全屏展示");
    expect(canvasSource).toContain("取消高亮");
    expect(canvasSource).toContain("未完全配置");
    expect(canvasSource).toContain("配置中");
    expect(canvasSource).toContain("已配置");
    expect(canvasSource).toContain("画布移动");
    expect(canvasSource).toContain("节点框选");
    expect(canvasSource).toContain("暂无配置信息");
    expect(canvasSource).toContain("高级 JSON 配置（保留扩展字段）");
    expect(canvasSource).toContain("LockKeyhole");
  });
});
