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
const processWorkbenchRunTabSource = readFileSync(new URL("../client/src/components/ProcessWorkbenchRunTab.tsx", import.meta.url), "utf8");
const processDetailPageSource = readFileSync(new URL("../client/src/components/WorkflowDetailPage.tsx", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const projectServiceSource = readFileSync(new URL("./project-service.ts", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../client/src/index.css", import.meta.url), "utf8");

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
    expect(homeSource).toContain("StructuredRunInput");
    expect(homeSource).toContain("运行字段");
    expect(homeSource).toContain("添加运行字段");
    expect(homeSource).toContain("canRun={canRun}");
    expect(homeSource).not.toContain('className="mt-2 h-20 w-full rounded border border-slate-200 bg-slate-50 p-2 font-mono');
  });

  it("保留原始业务中心的序号和根部门列表列，不以工作域伪造根部门", () => {
    expect(projectWorkspaceSource).toContain("序号");
    expect(projectWorkspaceSource).toContain("根部门");
    expect(projectWorkspaceSource).toContain("rootDepartment");
    expect(projectWorkspaceSource).toContain("当前内部项目模型未配置根部门，未以工作域字段替代。");
    expect(projectWorkspaceSource).toContain('colSpan={10}');
  });

  it("保留原始流程创建的代号、来源和项目数据源结构化字段", () => {
    expect(projectWorkspaceSource).toContain("流程代号，如 ORDER_APPROVAL");
    expect(projectWorkspaceSource).toContain("手工创建");
    expect(projectWorkspaceSource).toContain("从仓库导入");
    expect(projectWorkspaceSource).toContain("不关联数据源");
    expect(projectWorkspaceSource).toContain("流程代号在当前业务内唯一");
    expect(projectWorkspaceSource).toContain('workflow.processCode || String(workflow.id)');
    expect(warehouseSource).toContain('creationSource: "warehouse"');
    expect(warehouseSource).toContain("processCode:");
  });

  it("保留流程设计中心的项目内关联数据源列表列", () => {
    expect(projectWorkspaceSource).toContain("关联数据源");
    expect(projectWorkspaceSource).toContain("const sourceNameById = new Map(dataSources.map");
    expect(projectWorkspaceSource).toContain('workflow.flowType !== "data" ? "—"');
    expect(projectWorkspaceSource).toContain("已关联数据源");
    expect(projectWorkspaceSource).toContain("未关联");
  });

  it("保留仓库上传仅适用于状态和控制流程的类型边界", () => {
    expect(warehouseSource).toContain("数据流程不支持从流程仓库导入，请在数据资源中心独立设计和运行。");
    expect(projectWorkspaceSource).toContain("creationSource");
  });

  it("保留状态与控制流程的字段化发起面板，不暴露 JSON 输入", () => {
    expect(projectWorkspaceSource).toContain("发起流程");
    expect(projectWorkspaceSource).toContain("发起方类型");
    expect(projectWorkspaceSource).toContain("流程应结束时间（可选）");
    expect(projectWorkspaceSource).toContain("发起方角色键（可选）");
    expect(projectWorkspaceSource).toContain("业务信息一");
    expect(projectWorkspaceSource).toContain("业务信息二");
    expect(projectWorkspaceSource).toContain("业务信息三");
    expect(projectWorkspaceSource).toContain("businessInformationText");
    expect(projectWorkspaceSource).toContain("实际发起人由服务端会话身份记录");
    expect(projectWorkspaceSource).not.toContain("发起流程 JSON");
  });

  it("保留原始流程设计中心的项目级审批记录入口", () => {
    expect(projectWorkspaceSource).toContain("选择流程查看审批记录");
    expect(projectWorkspaceSource).toContain("trpc.project.workflowAudit.useQuery");
    expect(projectWorkspaceSource).toContain("仅展示当前业务内所选流程的审核与审核重置审计");
    expect(projectWorkspaceSource).toContain("正在读取审批记录…");
    expect(projectWorkspaceSource).toContain("审核通过");
    expect(projectWorkspaceSource).toContain("审核驳回");
    expect(projectWorkspaceSource).toContain("重置审核状态");
  });

  it("恢复原始项目工作区的受权业务选择控件和切换状态清理", () => {
    expect(homeSource).toContain('data-aiflow-business-selector');
    expect(homeSource).toContain("切换当前受权业务");
    expect(homeSource).toContain("仅显示当前账号具备查看权限的业务项目");
    expect(homeSource).toContain("setSelectedWorkflowId(null)");
    expect(projectWorkspaceSource).toContain('setView("process")');
    expect(projectWorkspaceSource).toContain("setFilters({})");
    expect(projectWorkspaceSource).not.toContain("detailWorkflowId");
  });

  it("保留原始系统配置的单一活动页签和内容面板关联", () => {
    expect(systemConfigSource).toContain('id="system-config-active-tab"');
    expect(systemConfigSource).toContain('aria-controls="system-config-card"');
    expect(systemConfigSource).toContain('id="system-config-card"');
    expect(systemConfigSource).toContain('role="tabpanel"');
    expect(systemConfigSource).toContain('aria-labelledby="system-config-active-tab"');
  });

  it("保留原始顶层四页签与当前流程工作台内容区域关联", () => {
    expect(homeSource).toContain('role="tablist" aria-label="流程工作台主导航"');
    expect(homeSource).toContain('id={`aiflow-console-tab-${item.id}`}');
    expect(homeSource).toContain('aria-controls="aiflow-console-panel"');
    expect(homeSource).toContain('aria-selected={section === item.id}');
    expect(homeSource).toContain('id="aiflow-console-panel" role="tabpanel"');
    expect(homeSource).toContain('aria-labelledby={`aiflow-console-tab-${section}`}');
  });

  it("保留顶层工作区的哈希路由同步与权限回退", () => {
    expect(homeSource).toContain('const consoleSections: Section[] = ["flows", "runs", "warehouse", "system"]');
    expect(homeSource).toContain("function sectionFromHash(hash: string): Section");
    expect(homeSource).toContain("function sectionHash(section: Section)");
    expect(homeSource).toContain("const navigateSection = useCallback");
    expect(homeSource).toContain("window.history.pushState(null, \"\", sectionHash(resolved))");
    expect(homeSource).toContain("window.addEventListener(\"popstate\", restoreHashSection)");
    expect(homeSource).toContain("window.addEventListener(\"hashchange\", restoreHashSection)");
    expect(homeSource).toContain('requested === "system" && user.role !== "admin" ? "flows" : requested');
  });

  it("保留窄屏工作区选择器与顶层路由联动", () => {
    expect(homeSource).toContain('data-aiflow-mobile-workspace-nav');
    expect(homeSource).toContain('aria-label="切换流程工作区"');
    expect(homeSource).toContain('onChange={event => navigateSection(event.target.value as Section)}');
    expect(homeSource).toContain('{nav.map(item => <option');
    expect(homeSource).toContain('md:hidden');
  });

  it("延迟加载非活动设计器与身份中心查询，避免首屏超大 tRPC 批量", () => {
    expect(homeSource).toContain('const editorActive = section === "flows" && flowView === "editor"');
    expect(homeSource).toContain('const identityActive = section === "system" && systemView === "identity" && user.role === "admin"');
    expect(homeSource).toContain('enabled: editorActive, staleTime: 60_000');
    expect(homeSource).toContain('enabled: editorActive, retry: false');
    expect(homeSource).toContain('enabled: identityActive, retry: false');
    expect(homeSource).toContain('Boolean(editorActive && selectedId)');
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
    expect(governanceSource).toContain("流程引导");
    expect(governanceSource).toContain("基本信息");
    expect(governanceSource).toContain('label: "流程设计"');
    expect(governanceSource).toContain('label: "审核"');
    expect(governanceSource).toContain('label: "发布"');
    expect(governanceSource).toContain('label: "运行"');
    expect(governanceSource).toContain("STARTED PROCESS LIST");
    expect(governanceSource).toContain("已启动流程列表");
    expect(governanceSource).toContain("正在读取已启动流程…");
    expect(governanceSource).toContain("请输入关键词按 Enter 搜索");
    expect(governanceSource).toContain("已启动流程 ID");
    expect(governanceSource).toContain("流程状态");
    expect(governanceSource).toContain("查看详细配置");
    expect(governanceSource).toContain("实例详情");
    expect(governanceSource).toContain("resetWorkflowAudit.useMutation");
    expect(governanceSource).toContain("重置审核状态");
    expect(governanceSource).toContain("project:manage");
    expect(governanceSource).toContain("最近发布时间");
    expect(governanceSource).toContain("最近取消发布时间");
    expect(governanceSource).toContain("unpublishedAt");
    expect(governanceSource).toContain('data-aiflow-process-detail=""');
    expect(canvasSource).toContain("flow:inspect-node");
  });

  it("恢复原始流程详情的基本信息字段化编辑，并与项目流程编辑权限一致", () => {
    expect(governanceSource).toContain("编辑基本信息");
    expect(governanceSource).toContain("编辑流程基本信息");
    expect(governanceSource).toContain("流程名称");
    expect(governanceSource).toContain("流程说明");
    expect(governanceSource).toContain("trpc.project.updateWorkflowInfo.useMutation");
    expect(governanceSource).toContain('projectAccess.data?.permissions?.has("project:workflow:edit")');
    expect(governanceSource).toContain("不会修改流程定义、审核状态、发布状态或运行记录");
    expect(governanceSource).toContain("<Input value={infoName}");
    expect(governanceSource).toContain("<Textarea value={infoDescription}");
    expect(governanceSource).not.toContain("基本信息 JSON");
    expect(governanceSource).not.toContain("JSON.parse");
    expect(projectWorkspaceSource).not.toContain("WorkflowDetailDialog");
    expect(projectWorkspaceSource).not.toContain("trpc.project.updateWorkflowInfo.useMutation");
    expect(routerSource).toContain("updateWorkflowInfo: protectedProcedure.input");
    expect(routerSource).toContain("description: z.string().trim().max(1200).nullable().optional()");
    expect(projectServiceSource).toContain('requireProjectPermission(user, input.projectId, "project:workflow:edit")');
    expect(projectServiceSource).toContain("WHERE id=? AND projectId=? LIMIT 1");
    expect(projectServiceSource).toContain("project_workflow_info_updated");
  });

  it("将原始流程详情承载为可关闭的受权详情视图，并保留只读画布和设计器返回路径", () => {
    expect(homeSource).toContain('"center" | "workspace" | "detail" | "editor"');
    expect(homeSource).toContain('const detailActive = section === "flows" && flowView === "detail"');
    expect(homeSource).toContain('onOpenDetail={workflowId => { setSelectedWorkflowId(workflowId); setFlowView("detail"); }}');
    expect(homeSource).toContain('flowView === "detail" && <WorkflowDetailPage');
    expect(projectWorkspaceSource).toContain("onOpenDetail: (workflowId: string) => void");
    expect(projectWorkspaceSource).toContain("onDetail={onOpenDetail}");
    expect(processDetailPageSource).toContain('data-aiflow-process-detail-page=""');
    expect(processDetailPageSource).toContain("WorkflowGovernance");
    expect(processDetailPageSource).toContain("canvas={");
    expect(processDetailPageSource).toContain("<WorkflowCanvas");
    expect(governanceSource).toContain("流程引导");
    expect(processDetailPageSource).toContain("返回流程设计中心");
    expect(processDetailPageSource).toContain("进入设计器");
    expect(processDetailPageSource).toContain("READ-ONLY CANVAS");
    expect(processDetailPageSource).toContain("流程图只读预览");
    expect(processDetailPageSource).toContain("详情页不会写入流程定义");
    expect(processDetailPageSource).toContain("readOnly");
    expect(governanceSource.indexOf("{canvas ??")).toBeGreaterThan(governanceSource.indexOf(">基本信息</span>"));
    expect(governanceSource.indexOf("{canvas ??")).toBeLessThan(governanceSource.indexOf("STARTED PROCESS LIST"));
  });

  it("保留运行筛选、耗时统计、失败告警和个人复用资产入口", () => {
    expect(runCenterSource).toContain("workflow.runMetrics.useQuery");
    expect(runCenterSource).toContain("按运行状态筛选");
    expect(runCenterSource).toContain("失败告警");
    expect(canvasSource).toContain("REUSE LIBRARY");
    expect(canvasSource).toContain("保存为节点模板");
    expect(canvasSource).toContain("在画布中编辑");
    expect(canvasSource).not.toContain("模板 JSON 配置");
    expect(canvasSource).not.toContain("高级 JSON 配置");
    expect(canvasSource).not.toContain("应用 JSON 配置");
    expect(homeSource).toContain("保存当前定义为子流程");
  });

  it("为原版操作、路由和子流程复杂结构提供专用字段控件并保留扩展字段", () => {
    expect(canvasSource).toContain("ORIGINAL_OBJECT_FIELD_SPECS");
    expect(canvasSource).toContain("ORIGINAL_LIST_ITEM_SPECS");
    expect(canvasSource).toContain("权限 ID");
    expect(canvasSource).toContain("绑定名称");
    expect(canvasSource).toContain("优先权重");
    expect(canvasSource).toContain("目标节点");
    expect(canvasSource).toContain("流程 ID");
    expect(canvasSource).toContain("子流程出口");
    expect(canvasSource).toContain("原版扩展字段");
    expect(canvasSource).toContain("Object.entries(record).filter(([key]) => !knownKeys.has(key))");
  });

  it("提供显式且可撤销的连线删除交互，并在只读模式禁用删除", () => {
    expect(canvasSource).toContain("selectedEdgeId");
    expect(canvasSource).toContain("interactionWidth: 24");
    expect(canvasSource).toContain("onEdgeClick");
    expect(canvasSource).toContain("删除连线");
    expect(canvasSource).toContain("Delete");
    expect(canvasSource).toContain("Backspace");
    expect(canvasSource).toContain("撤销删线");
    expect(canvasSource).toContain("if (readOnly || !selectedEdgeId) return");
    expect(canvasSource).toContain("!readOnly && <Button");
  });

  it("恢复原版画布左右键、框选、拖放和路径菜单交互", () => {
    expect(canvasSource).toContain("allowedCanvasTargets");
    expect(canvasSource).toContain("canConnectCanvasNodes");
    expect(canvasSource).toContain("onNodeSelectionClick");
    expect(canvasSource).toContain("event.shiftKey || event.ctrlKey || event.metaKey");
    expect(canvasSource).toContain("handlePaletteDragStart");
    expect(canvasSource).toContain("handleCanvasDrop");
    expect(canvasSource).toContain("selectionOnDrag={!readOnly}");
    expect(canvasSource).toContain('contextMenu.kind === "group"');
    expect(canvasSource).toContain("横向对齐");
    expect(canvasSource).toContain("竖向对齐");
    expect(canvasSource).toContain("批量删除");
    expect(canvasSource).toContain("取消框选");
    expect(canvasSource).toContain("查看节点编号");
    expect(canvasSource).toContain("查看路径");
    expect(canvasSource).toContain("修改名称");
    expect(canvasSource).toContain("nodes.filter(node => node.selected");
  });
  it("按原版语义分组操作、路由与子流程配置并解释当前运行字段", () => {
    expect(canvasSource).toContain("CONFIG_GROUPS");
    expect(canvasSource).toContain('label: "人员与操作"');
    expect(canvasSource).toContain('label: "流程参与方显示"');
    expect(canvasSource).toContain('label: "权限控制"');
    expect(canvasSource).toContain('label: "绑定对象"');
    expect(canvasSource).toContain('label: "绑定操作"');
    expect(canvasSource).toContain('label: "属性设置"');
    expect(canvasSource).toContain('label: "发送方设置"');
    expect(canvasSource).toContain('label: "接收方设置"');
    expect(canvasSource).toContain('label: "自动执行"');
    expect(canvasSource).toContain('label: "原版路由设置"');
    expect(canvasSource).toContain('label: "当前安全路由规则"');
    expect(canvasSource).toContain('label: "流转方式"');
    expect(canvasSource).toContain('label: "入口映射"');
    expect(canvasSource).toContain('label: "出口映射"');
    expect(canvasSource).toContain('label: "当前运行映射"');
    expect(canvasSource).toContain("不会覆盖上面的原版兼容配置");
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
    expect(systemConfigSource).toContain('data-aiflow-system-config=""');
    expect(styleSource).toContain("[data-aiflow-system-config] > div");
    expect(styleSource).toContain("grid-template-columns: 216px minmax(0, 1fr)");
    expect(projectWorkspaceSource).toContain("状态流程");
    expect(projectWorkspaceSource).toContain("控制流程");
    expect(projectWorkspaceSource).toContain("数据流程");
    expect(projectWorkspaceSource).toContain("收起项目工作区导航");
    expect(projectWorkspaceSource).toContain("展开项目工作区导航");
    expect(projectWorkspaceSource).toContain("当前业务：");
    expect(projectWorkspaceSource).toContain("PanelLeftClose");
    expect(projectWorkspaceSource).toContain("PanelLeftOpen");
    expect(projectWorkspaceSource).toContain('data-aiflow-project-workspace=""');
    expect(styleSource).toContain("[data-aiflow-project-workspace] > aside");
    expect(styleSource).toContain("width: 216px !important");
    expect(projectWorkspaceSource).toContain("创建时间开始");
    expect(projectWorkspaceSource).toContain("创建时间结束");
    expect(projectWorkspaceSource).toContain("同步 BDP 配置");
    expect(projectWorkspaceSource).toContain("导入业务");
    expect(projectWorkspaceSource).toContain('accept=".csv,text/csv"');
    expect(projectWorkspaceSource).toContain("CSV 标题必须包含");
    expect(projectWorkspaceSource).toContain("业务代号、业务名称");
    expect(projectWorkspaceSource).toContain("筛选仅作用于当前已授权可见的业务项目");
    expect(projectWorkspaceSource).toContain('view === "process" && workflows.isLoading');
    expect(projectWorkspaceSource).toContain("正在读取项目流程");
    expect(projectWorkspaceSource).toContain("正在加载当前业务授权范围内的流程与审核状态");
    expect(projectWorkspaceSource).toContain("重置筛选");
    expect(projectWorkspaceSource).toContain("可重置筛选或从右上角新建状态、控制或数据流程");
    expect(projectWorkspaceSource).toContain("最近取消发布时间");
    expect(projectWorkspaceSource).toContain("尚未取消发布");
    expect(projectWorkspaceSource).toContain("workflow.publishedAt ? formatDate(workflow.publishedAt)");
    expect(projectWorkspaceSource).toContain("workflow.unpublishedAt ? formatDate(workflow.unpublishedAt)");
    expect(projectWorkspaceSource).toContain('colSpan={12}');
    expect(projectWorkspaceSource).toContain('workflow.flowType === "data" ? "启动" : "发起流程"');
    expect(projectWorkspaceSource).toContain('trpc.workflow.publish.useMutation');
    expect(projectWorkspaceSource).toContain('trpc.workflow.unpublish.useMutation');
    expect(projectWorkspaceSource).toContain('workflow.status === "draft" && workflow.auditStatus === "approved"');
    expect(projectWorkspaceSource).toContain('workflow.status === "published" && <button');
    expect(projectWorkspaceSource).toContain('>取消发布</button>');
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
    expect(nodeContractSource).toContain('type: "method"');
    expect(nodeContractSource).toContain('type: "form"');
    expect(nodeContractSource).toContain('type: "sql"');
    expect(warehouseSource).toContain("流程列表");
    expect(warehouseSource).toContain("请输入搜索内容");
    expect(warehouseSource).toContain("批量操作");
    expect(warehouseSource).toContain("批量导入");
    expect(warehouseSource).toContain("流程简介");
    expect(warehouseSource).toContain("没有搜到任何数据");
    expect(warehouseSource).toContain("只读流程图");
    expect(warehouseSource).toContain("hasFolderMatch");
    expect(warehouseSource).toContain("rawChildren(folder.id).some(hasFolderMatch)");
    expect(warehouseSource).toContain("新增同级文件夹");
    expect(warehouseSource).toContain("新增子级文件夹");
    expect(warehouseSource).toContain("添加同级");
    expect(warehouseSource).toContain("添加子级");
    expect(warehouseSource).toContain("确认删除");
    expect(warehouseSource).toContain("trpc.workflow.delete.useMutation");
    expect(warehouseSource).toContain("删除流程");
    expect(warehouseSource).toContain("关联版本、运行与成员授权已由服务端按安全顺序清理");
    expect(warehouseSource).toContain("取消高亮");
    expect(warehouseSource).toContain("保存为图片");
    expect(warehouseSource).toContain("全屏");
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
    expect(canvasSource).toContain("StructuredValueEditor");
    expect(canvasSource).toContain("StructuredListRow");
    expect(canvasSource).toContain("NestedStructuredValueEditor");
    expect(canvasSource).toContain("添加对象字段");
    expect(canvasSource).toContain("添加数组字段");
    expect(canvasSource).toContain("添加对象");
    expect(canvasSource).toContain("添加数组");
    expect(canvasSource).toContain('field.kind === "boolean"');
    expect(canvasSource).toContain('["restHeaderParam", "restGetBodyParam"].includes(fieldKey)');
    expect(canvasSource).toContain("GET 参数");
    expect(canvasSource).toContain("添加字段");
    expect(canvasSource).toContain("添加一项");
    expect(canvasSource).not.toContain("function JsonField");
    expect(canvasSource).toContain("LockKeyhole");
    expect(canvasSource).toContain("最大化面板");
    expect(canvasSource).toContain("恢复配置面板");
    expect(canvasSource).toContain("最小化面板");
    expect(canvasSource).toContain("RotateCcw");
    expect(canvasSource).toContain("若无元件，请添加元件。");
    expect(canvasSource).toContain("当前裁剪安装包未保留节点打包脚本");
    expect(canvasSource).toContain("next.nodes.some(node => node.id === current)");
    expect(homeSource).toContain("点击流程名称可返回流程设计中心");
    expect(homeSource).toContain("onBackToDesignCenter");
    expect(homeSource).toContain("保存画布");
  });

  it("保留原始流程详情的流程图标题段、画布工具和安全画布联动", () => {
    expect(governanceSource).toContain("流程图");
    expect(governanceSource).toContain("详情工具安全作用于当前页面的流程画布");
    expect(governanceSource).toContain("flow:clear-highlight");
    expect(governanceSource).toContain("flow:neaten-canvas");
    expect(governanceSource).toContain("flow:save-canvas-image");
    expect(governanceSource).toContain("flow:fullscreen-canvas");
    expect(canvasSource).toContain("window.addEventListener(\"flow:clear-highlight\"");
    expect(canvasSource).toContain("window.addEventListener(\"flow:neaten-canvas\"");
    expect(canvasSource).toContain("window.addEventListener(\"flow:save-canvas-image\"");
    expect(canvasSource).toContain("window.addEventListener(\"flow:fullscreen-canvas\"");
  });

  it("保留原始数据流画布的资源树、函数树、任务与调度入口及禁用工具状态", () => {
    expect(dataResourceSource).toContain("DATAFLOW CANVAS REFERENCE");
    expect(dataResourceSource).toContain('projectName} · 数据流画布');
    expect(dataResourceSource).toContain('trpc.project.list.useQuery()');
    expect(dataResourceSource).toContain("数据资源");
    expect(dataResourceSource).toContain("函数资源");
    expect(dataResourceSource).toContain("一键展开");
    expect(dataResourceSource).toContain("任务详情");
    expect(dataResourceSource).toContain("dataflow-task-summary");
    expect(dataResourceSource).toContain("查看当前受权数据流摘要");
    expect(dataResourceSource).toContain("托管计划");
    expect(dataResourceSource).toContain("调度配置");
    expect(dataResourceSource).toContain("交集");
    expect(dataResourceSource).toContain("差集");
    expect(dataResourceSource).toContain("并集");
    expect(dataResourceSource).toContain("TSML");
    expect(dataResourceSource).toContain("StructuredResourceForm");
    expect(dataResourceSource).toContain('title === "添加数据源" || title === "资源探查结果"');
    expect(dataResourceSource).toContain("return null;");
    expect(dataResourceSource).not.toContain("JSON.parse");
    expect(dataResourceSource).not.toContain("sourceForm.");
    expect(dataResourceSource).not.toContain("assetForm.");
    expect(dataResourceSource).toContain("data-resource-center");
    expect(dataResourceSource).toContain("dataflow-operation-list");
    expect(dataResourceSource).toContain("已操作流程列表");
    expect(dataResourceSource).toContain("请输入关键词按 Enter 键搜索");
    expect(dataResourceSource).toContain("未找到匹配的已操作流程。");
    expect(dataResourceSource).toContain("操作 ID");
    expect(dataResourceSource).toContain("结束时间");
    expect(dataResourceSource).toContain("查看审计");
    expect(dataResourceSource).toContain("dataflow-canvas-utility-actions");
    expect(dataResourceSource).toContain('dataflow-canvas-utility-actions=""');
    expect(dataResourceSource).toContain("保存为图片");
    expect(dataResourceSource).toContain("整理画布");
    expect(dataResourceSource).toContain("测试执行");
    expect(dataResourceSource).toContain("onTestRun");
    expect(dataResourceSource).toContain("对当前已发布数据流执行一次受权限保护的测试运行");
    expect(dataResourceSource).toContain("打开设计器");
    expect(dataResourceSource).not.toContain("打开并保存画布");
    expect(styleSource).toContain('[data-resource-center] > section:has(+ [dataflow-canvas-utility-actions]) > div:first-child');
    expect(styleSource).toContain('[data-resource-center] [dataflow-canvas-utility-actions]');
    expect(dataResourceSource).toContain("已打开“${flow.name}”设计器");
  });

  it("保留数据流画布一键展开的资源树状态关联", () => {
    expect(dataResourceSource).toContain('aria-controls="dataflow-resource-trees"');
    expect(dataResourceSource).toContain("aria-expanded={expanded}");
    expect(dataResourceSource).toContain('id="dataflow-resource-trees"');
    expect(dataResourceSource).toContain('expanded ? "收起资源树" : "一键展开"');
  });

  it("系统配置保持字段化表单，不要求管理员编辑 JSON", () => {
    expect(systemConfigSource).toContain("平台名称");
    expect(systemConfigSource).toContain("要求审核通过后发布");
    expect(systemConfigSource).toContain("工作域名称");
    expect(systemConfigSource).not.toContain("JSON.parse");
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
    expect(processWorkbenchSource).toContain('result: { decision: "approved" }');
    expect(processWorkbenchSource).not.toContain("批量处理结果必须是合法 JSON 对象");
    expect(processWorkbenchSource).toContain("处理结果字段");
    expect(processWorkbenchSource).toContain("添加处理结果字段");
    expect(processWorkbenchSource).not.toContain("function LegacyTaskDrawer");
    expect(processWorkbenchSource).not.toContain("处理结果（JSON）");
    expect(processWorkbenchSource).not.toContain("JSON.parse(resultText)");
    expect(homeSource).not.toContain("运行输入必须是合法 JSON 对象");
    expect(homeSource).not.toContain("JSON.parse(runInput)");
    expect(homeSource).toContain('useState<Record<string, unknown>>({ id: 2, prompt: "请总结输入内容" })');
    expect(homeSource).toContain("onChange(Object.fromEntries");
    expect(processWorkbenchSource).toContain("onComplete(createPayload(resultRows))");
    expect(processWorkbenchSource).toContain("收起已启动流程导航");
    expect(processWorkbenchSource).toContain("展开已启动流程导航");
    expect(processWorkbenchSource).toContain("当前视图仅展示具备运行权限的流程实例与人工任务");
    expect(processWorkbenchSource).toContain("PanelLeftClose");
    expect(processWorkbenchSource).toContain("PanelLeftOpen");
    expect(processWorkbenchSource).toContain("data-process-workbench-loading");
    expect(processWorkbenchSource).toContain("正在读取已启动流程");
    expect(processWorkbenchSource).toContain("正在加载当前授权范围内的看板统计与最近任务");
    expect(processWorkbenchSource).toContain("ProcessWorkbenchRunTab");
    expect(processWorkbenchSource).toContain("onOpenRun={setSelectedRunId}");
    expect(processWorkbenchSource).toContain("baseTabLabel={labels[view]}");
    expect(processWorkbenchSource).toMatch(/const closeRunTab = \(\) => \{\s*setSelectedRunId\(null\);\s*invalidate\(\);\s*\}/);
    expect(processWorkbenchSource).toMatch(/setSelectedRunId\(null\);\s*setSelectedTaskId\(null\);\s*setSelectedTaskIds\(\[\]\);\s*invalidate\(\);/);
    expect(styleSource).toContain('min-height: 46px;');
    expect(processWorkbenchRunTabSource).toContain("关闭实例详情页签");
    expect(processWorkbenchRunTabSource).toContain("返回工作台");
    expect(processWorkbenchRunTabSource).toContain("trpc.workflow.runDetail.useQuery");
    expect(processWorkbenchRunTabSource).toContain("baseTabLabel");
    expect(processWorkbenchRunTabSource).toContain('title={`返回${baseTabLabel}`}');
    expect(processWorkbenchRunTabSource).toContain('data-process-workbench-tabs');
  });

  it("原安装包视觉壳层保持浅色平面工作台与三栏画布结构", () => {
    expect(homeSource).toContain('data-aiflow-console=""');
    expect(homeSource).toContain('data-aiflow-designer=""');
    expect(homeSource).toContain("AI FLOW GRAPH");
    expect(homeSource).not.toContain("NEBULA BUSINESS ENGINE");
    expect(styleSource).not.toContain('[data-aiflow-designer] textarea.h-20.font-mono');
    expect(homeSource).toContain('AI FLOW GRAPH');
    expect(homeSource).toContain('bg-[#f4f6f9]');
    expect(homeSource).not.toContain('NEBULA INSPIRED · V3');
    expect(canvasSource).toContain('data-aiflow-workflow-canvas=""');
    expect(projectWorkspaceSource).toContain('data-aiflow-business-center=""');
    expect(warehouseSource).toContain('data-aiflow-warehouse=""');
    expect(styleSource).toContain('content: "AI FLOW GRAPH"');
    expect(styleSource).toContain('[data-aiflow-business-center]');
    expect((styleSource.match(/\[data-aiflow-business-center\] > div > div:first-child \{/g) ?? []).length).toBe(1);
    expect(styleSource).toContain('[data-aiflow-business-center] > div > div:first-child > div > div > p');
    expect(styleSource).toContain('min-height: 48px;');
    expect(styleSource).toContain('[data-aiflow-designer] [data-aiflow-workflow-canvas]');
    expect(styleSource).toContain('[data-aiflow-designer] > [data-aiflow-workflow-canvas]');
    expect(styleSource).toContain('order: 2;');
    expect(styleSource).toContain('[data-aiflow-designer] > [data-structured-run-input]');
    expect(styleSource).toContain('[data-aiflow-warehouse] > div > .grid');
    expect(styleSource).toContain('[data-aiflow-warehouse] > div > div:first-child > select');
    expect(styleSource).toContain('min-height: 40px;');
    expect(styleSource).toContain('[data-aiflow-process-detail]');
    expect(styleSource).toContain('[data-aiflow-system-config]');
    expect(styleSource).not.toContain('div:has(> aside button[title="收起配置导航"])');
    expect(styleSource).toContain('button[aria-label="收起已启动流程导航"]');
    expect(styleSource).toContain('button[aria-label="展开已启动流程导航"]');
  });
});
