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
const dataResourceSource = readFileSync(new URL("../client/src/components/DataResourceCenter.tsx", import.meta.url), "utf8");
const processWorkbenchSource = readFileSync(new URL("../client/src/components/ProcessWorkbench.tsx", import.meta.url), "utf8");

describe("流程设计器界面回归约束", () => {
  it("新建流程按钮提交表单，控制台壳层可在窄屏纵向收敛", () => {
    expect(homeSource).toContain('<Button type="submit" size="sm" className="h-8"');
    expect(homeSource).toContain('flex min-h-[calc(100vh-56px)] flex-col md:flex-row');
    expect(homeSource).toContain('sidebarOpen ? "w-full md:w-72"');
    expect(homeSource).toContain('key={`${workflow.id}:${workflow.definitionVersion}`}');
    expect(homeSource).not.toContain('workflow.definitionVersion}:${JSON.stringify(definition).length');
    expect(homeSource).toContain("trpc.workflow.unpublish.useMutation");
    expect(homeSource).toContain("取消发布");
    expect(homeSource).toContain("历史版本与运行审计已保留");
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
    expect(governanceSource).toContain("流程引导与基本信息");
    expect(governanceSource).toContain('label: "流程设计"');
    expect(governanceSource).toContain('label: "审核"');
    expect(governanceSource).toContain('label: "发布"');
    expect(governanceSource).toContain('label: "运行"');
    expect(governanceSource).toContain("STARTED PROCESS LIST");
    expect(governanceSource).toContain("已启动流程列表");
    expect(governanceSource).toContain("请输入关键词按 Enter 搜索");
    expect(governanceSource).toContain("已启动流程 ID");
    expect(governanceSource).toContain("流程状态");
    expect(governanceSource).toContain("查看详细配置");
    expect(governanceSource).toContain("实例详情");
    expect(canvasSource).toContain("flow:inspect-node");
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
    expect(systemConfigSource).toContain("工作域配置");
    expect(systemConfigSource).toContain("收起配置导航");
    expect(systemConfigSource).toContain("展开配置导航");
    expect(systemConfigSource).toContain("系统配置卡片页签");
    expect(projectWorkspaceSource).toContain("状态流程");
    expect(projectWorkspaceSource).toContain("控制流程");
    expect(projectWorkspaceSource).toContain("数据流程");
    expect(projectWorkspaceSource).toContain("收起项目工作区导航");
    expect(projectWorkspaceSource).toContain("展开项目工作区导航");
    expect(projectWorkspaceSource).toContain("当前业务：");
    expect(projectWorkspaceSource).toContain("PanelLeftClose");
    expect(projectWorkspaceSource).toContain("PanelLeftOpen");
    expect(projectWorkspaceSource).toContain("创建时间开始");
    expect(projectWorkspaceSource).toContain("创建时间结束");
    expect(projectWorkspaceSource).toContain("同步 BDP 配置");
    expect(projectWorkspaceSource).toContain("筛选仅作用于当前已授权可见的业务项目");
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
    expect(warehouseSource).toContain("流程列表");
    expect(warehouseSource).toContain("请输入搜索内容");
    expect(warehouseSource).toContain("批量操作");
    expect(warehouseSource).toContain("批量导入");
    expect(warehouseSource).toContain("流程简介");
    expect(warehouseSource).toContain("没有搜到任何数据");
    expect(warehouseSource).toContain("只读流程图");
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
    expect(canvasSource).toContain("当前裁剪安装包未保留节点打包脚本");
    expect(canvasSource).toContain("next.nodes.some(node => node.id === current)");
  });

  it("保留原始数据流画布的资源树、函数树、任务与调度入口及禁用工具状态", () => {
    expect(dataResourceSource).toContain("DATAFLOW CANVAS REFERENCE");
    expect(dataResourceSource).toContain("数据资源");
    expect(dataResourceSource).toContain("函数资源");
    expect(dataResourceSource).toContain("一键展开");
    expect(dataResourceSource).toContain("任务详情");
    expect(dataResourceSource).toContain("调度配置");
    expect(dataResourceSource).toContain("交集");
    expect(dataResourceSource).toContain("差集");
    expect(dataResourceSource).toContain("并集");
    expect(dataResourceSource).toContain("TSML");
  });

  it("保留已启动流程的任务移交、退回与逐项批量处理入口", () => {
    expect(processWorkbenchSource).toContain("批量领取");
    expect(processWorkbenchSource).toContain("批量完成");
    expect(processWorkbenchSource).toContain("任务移交与回退");
    expect(processWorkbenchSource).toContain("移交");
    expect(processWorkbenchSource).toContain("退回待处理");
    expect(processWorkbenchSource).toContain("不会跨流程或跨项目执行");
    expect(processWorkbenchSource).toContain("trpc.task.handover.useMutation");
    expect(processWorkbenchSource).toContain("trpc.task.batchComplete.useMutation");
    expect(processWorkbenchSource).toContain("收起已启动流程导航");
    expect(processWorkbenchSource).toContain("展开已启动流程导航");
    expect(processWorkbenchSource).toContain("当前视图仅展示具备运行权限的流程实例与人工任务");
    expect(processWorkbenchSource).toContain("PanelLeftClose");
    expect(processWorkbenchSource).toContain("PanelLeftOpen");
  });
});
