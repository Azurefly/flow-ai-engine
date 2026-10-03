import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canPublishWorkflowVersion,
  matchesWorkflowDefinitionSnapshot,
} from "../shared/workflow-publish";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+/g, " ");
const homeSource = source("../client/src/pages/Home.tsx");
const runModalSource = source(
  "../client/src/components/WorkflowTestRunModal.tsx"
);
const canvasSource = source("../client/src/components/WorkflowCanvas.tsx");
const nodeContractSource = source("../shared/workflow-node-contract.ts");
const flowProfileSource = source("../shared/flow-profile-contract.ts");
const governanceSource = source(
  "../client/src/components/WorkflowGovernance.tsx"
);
const runCenterSource = source("../client/src/components/RunCenter.tsx");
const runPayloadDetailsSource = source(
  "../client/src/components/RunPayloadDetails.tsx"
);
const projectWorkspaceSource = source(
  "../client/src/components/ProjectWorkspace.tsx"
);
const warehouseSource = source(
  "../client/src/components/WorkflowWarehouse.tsx"
);
const systemConfigSource = source(
  "../client/src/components/SystemConfigShell.tsx"
);
const organizationPageSource = source(
  "../client/src/components/OrganizationManagementPage.tsx"
);
const dialogSource = source("../client/src/components/ui/dialog.tsx");
const commandSource = source("../client/src/components/ui/command.tsx");
const internalAuthSource = source("./internal-auth.ts");
const organizationServiceSource = source("./organization-service.ts");
const dataResourceSource = source(
  "../client/src/components/DataResourceCenter.tsx"
);
const creationDialogSource = source(
  "../client/src/components/CreationDialog.tsx"
);
const processWorkbenchSource = source(
  "../client/src/components/ProcessWorkbench.tsx"
);
const p1ServiceSource = source("./p1-service.ts");
const processWorkbenchRunTabSource = source(
  "../client/src/components/ProcessWorkbenchRunTab.tsx"
);
const instanceDetailSource = source(
  "../client/src/components/WorkflowGovernanceRunDetail.tsx"
);
const processDetailPageSource = source(
  "../client/src/components/WorkflowDetailPage.tsx"
);
const consoleRouteSource = source("../shared/console-route.ts");
const routerSource = source("./routers.ts");
const workflowServiceSource = source("./workflow-service.ts");
const workflowEngineSource = source("./workflow-engine.ts");
const projectServiceSource = source("./project-service.ts");
const dataflowServiceSource = source("./p2-service.ts");
const iamServiceSource = source("./iam-service.ts");
const styleSource = source("../client/src/index.css");
const appSource = source("../client/src/App.tsx");
const htmlSource = source("../client/index.html");
const mainSource = source("../client/src/main.tsx");
const packageSource = source("../package.json");
const bundleBudgetSource = source("../scripts/check-bundle-budget.mjs");
const viteConfigSource = source("../vite.config.ts");
const tableHeaderClasses = [
  projectWorkspaceSource,
  dataResourceSource,
  organizationPageSource,
  systemConfigSource,
  governanceSource,
  processWorkbenchSource,
  runModalSource,
].flatMap(fileSource =>
  [...fileSource.matchAll(/<thead className="([^"]*)"/g)].map(match => match[1])
);

describe("流程版本发布状态", () => {
  it("草稿仍可发布，已发布流程只有存在未发布修改时才能创建新版本", () => {
    expect(canPublishWorkflowVersion("draft", false)).toBe(true);
    expect(canPublishWorkflowVersion("published", false)).toBe(false);
    expect(canPublishWorkflowVersion("published", true)).toBe(true);
  });

  it("设计器和发布回调都遵守相同的版本门禁并解释禁用原因", () => {
    expect(homeSource).toContain("canPublishWorkflowVersion(");
    expect(homeSource).toContain("!publishVersionAllowed");
    expect(homeSource).toContain("没有未发布修改；编辑流程后才能发布新版本");
    expect(homeSource).toContain("发布新版本");
  });

  it("没有未保存修改时禁用草稿保存并拦截快捷键空保存", () => {
    expect(homeSource).toContain(
      "if (!selectedId || !draftDefinition || !isDraftDirty) return;"
    );
    expect(homeSource).toContain(
      "!canEdit || !hasUnpublishedChanges || savePending"
    );
    expect(homeSource).toContain("没有未保存修改");
    expect(workflowServiceSource).toContain("isWorkflowUpdateNoop({");
    expect(workflowServiceSource).toContain("return current;");
  });

  it("已发布定义的快照比较忽略JSON键顺序，但识别真实字段变化", () => {
    const persisted = JSON.stringify({
      schemaVersion: 1,
      nodes: [{ id: "state", config: { field: "value", enabled: true } }],
    });

    expect(
      matchesWorkflowDefinitionSnapshot(persisted, {
        nodes: [{ id: "state", config: { enabled: true, field: "value" } }],
        schemaVersion: 1,
      })
    ).toBe(true);
    expect(
      matchesWorkflowDefinitionSnapshot(persisted, {
        schemaVersion: 1,
        nodes: [{ id: "state", config: { field: "changed", enabled: true } }],
      })
    ).toBe(false);
  });

  it("画布只回写真实变化，并保留既有节点和连线字段", () => {
    expect(canvasSource).toContain("...baseNodes.get(node.id)");
    expect(canvasSource).toContain("...baseEdges.get(edge.id)");
    expect(canvasSource).toContain(
      "matchesWorkflowDefinitionSnapshot( JSON.stringify(definition ?? defaultDefinition()), next )"
    );
  });
});

describe("候选登录页面可访问性", () => {
  it("装饰性品牌图标对读屏隐藏，账号字段保留登录自动填充语义", () => {
    const loginStart = homeSource.indexOf("function LoginScreen(");
    const loginEnd = homeSource.indexOf("function FlowConsole(", loginStart);
    const loginSource = homeSource.slice(loginStart, loginEnd);

    expect(loginSource).toMatch(
      /<div\s+aria-hidden="true"[\s\S]*?<Gauge size=\{21\} \/>/
    );
    expect(loginSource).toContain('autoComplete="username"');
    expect(loginSource).toContain('autoComplete="current-password"');
    expect(loginSource).toContain('type="password"');
    expect(loginSource).toContain("minLength={12}");
    expect(loginSource.match(/required/g)).toHaveLength(2);
  });
});

describe("全站数据表格字号层级", () => {
  it("列标题使用14px控件层级，不缩成13px辅助文字", () => {
    expect(tableHeaderClasses.length).toBeGreaterThan(0);
    expect(
      tableHeaderClasses.every(
        className =>
          className.includes("text-sm") ||
          className.includes("aiflow-type-body") ||
          className.includes("aiflow-type-control")
      )
    ).toBe(true);
    expect(
      tableHeaderClasses.some(
        className =>
          className.includes("text-xs") ||
          className.includes("aiflow-type-meta")
      )
    ).toBe(false);
  });
});

describe("共享对话框关闭控件", () => {
  it("触控区域适配手机且提供中文无障碍名称", () => {
    expect(dialogSource).toContain('className="ring-offset-background');
    expect(dialogSource).toContain("h-11 w-11 items-center justify-center");
    expect(dialogSource).toContain("min-[1024px]:h-10 min-[1024px]:w-10");
    expect(dialogSource).toContain(
      '<span className="sr-only">关闭对话框</span>'
    );
    expect(dialogSource).not.toContain(
      '<span className="sr-only">Close</span>'
    );
  });
});

describe("工作台只读任务运行详情入口", () => {
  it("只在服务端确认 workflow:view 后显示链接并切换到已有详情面板", () => {
    expect(p1ServiceSource).toMatch(
      /canViewRun:\s*await hasWorkflowPermission\(\s*user,\s*String\(task\.workflowId\),\s*"workflow:view"\s*\)/
    );
    expect(processWorkbenchSource).toContain("task.canViewRun === true");
    expect(processWorkbenchSource).toContain("查看运行详情");
    expect(processWorkbenchSource).toMatch(
      /onOpenRun=\{\(runId: string\) => \{\s*setSelectedTaskId\(null\);\s*setSelectedRunId\(runId\);\s*\}\}/
    );
    expect(processWorkbenchSource).toContain("<ProcessWorkbenchRunTab");
  });
});

describe("流程设计器界面回归约束", () => {
  it("运行入口明确发起真实运行，不宣传仿真、抽样、单步或沙箱隔离", () => {
    expect(homeSource).toContain('"运行状态流程"');
    expect(homeSource).toContain('"执行数据流程"');
    expect(homeSource).toContain('"运行控制流程"');
    expect(homeSource).not.toContain("流程仿真");
    expect(homeSource).not.toContain("抽样试跑");
    expect(homeSource).not.toContain("单步调试");
    expect(runModalSource).toContain("当前入口不提供沙箱隔离");
    expect(runModalSource).toContain("提交后会直接执行并创建运行记录");
    expect(runModalSource).toContain("开始实际数据流程");
    expect(runModalSource).toContain("再次创建实际运行");
    expect(runModalSource).toContain("max-h-[calc(100dvh-1rem)]");
    expect(runModalSource).toContain(
      "min-h-0 flex-1 overflow-y-auto overscroll-contain"
    );
    expect(runModalSource).toContain("grid-cols-[minmax(0,1fr)_2rem]");
    expect(runModalSource).not.toContain("min-h-[380px]");
    expect(runModalSource).toContain("运行已排队，等待执行器");
    expect(runModalSource).toContain("本页展示本次运行结果与节点轨迹");
    expect(runModalSource).not.toContain("沙箱中");
    expect(runModalSource).not.toContain("立即开始试运行");
    expect(runModalSource).not.toContain("试运行结果仅供画布实时调试");
    expect(runModalSource).toContain("runDataflowMutation.mutateAsync");
    expect(runModalSource).toContain("runWorkflowMutation.mutateAsync");
  });

  it("把真实运行与独立预检从紧凑主工具栏移入操作菜单", () => {
    const designerStart = homeSource.indexOf("function FlowDesigner(");
    const designerEnd = homeSource.indexOf(
      "function valueFromField(",
      designerStart
    );
    const designerSource = homeSource.slice(designerStart, designerEnd);
    const menuStart = designerSource.indexOf("<DropdownMenuContent");
    const menuEnd = designerSource.indexOf("</DropdownMenuContent>", menuStart);
    const operationMenu = designerSource.slice(menuStart, menuEnd);

    expect(designerStart).toBeGreaterThanOrEqual(0);
    expect(menuStart).toBeGreaterThanOrEqual(0);
    expect(menuEnd).toBeGreaterThan(menuStart);
    expect(operationMenu).toContain("onClick={() => setRunDialogOpen(true)}");
    expect(operationMenu).toContain("disabled={!canRun}");
    expect(operationMenu).toContain("运行控制流程");
    expect(operationMenu).toContain("仅执行预检");
    expect(operationMenu).toContain('className="aiflow-type-control"');
    expect(
      designerSource.indexOf("onClick={() => setRunDialogOpen(true)}")
    ).toBeGreaterThan(menuStart);
    expect(designerSource).toContain("发布前会自动检查拓扑与语法");
  });

  it("等待草稿保存成功后才启动，并在运行记录中展示实际执行版本", () => {
    expect(homeSource).toContain("await saveFlow.mutateAsync({");
    expect(homeSource).toContain("if (!isDraftDirty) return;");
    expect(homeSource).toContain("onSaveDraftBeforeRun={saveDraftBeforeRun}");
    expect(runModalSource).toContain("runAfterDraftSave({");
    expect(runModalSource).toContain("草稿保存失败，未启动运行");
    expect(runModalSource).toContain("服务端已保存的草稿定义");
    expect(runModalSource).toContain(
      'currentRun.executionSource === "published_plan"'
    );
    expect(workflowEngineSource).toContain(
      'executionSource === "published_plan"'
    );
    expect(workflowEngineSource).toContain(
      "executionSource,definitionVersion,requestId"
    );
    expect(dataflowServiceSource).toContain(
      "executionSource,definitionVersion,requestId"
    );
  });

  it("中文可访问性基线、工作区拆包和 bundle budget 保持生效", () => {
    expect(htmlSource).toContain('<html lang="zh-CN">');
    expect(htmlSource).not.toContain("maximum-scale=1");
    expect(htmlSource).not.toContain("%VITE_ANALYTICS_ENDPOINT%");
    expect(mainSource).toContain("installOptionalAnalytics");
    expect(mainSource).toContain("if (!endpoint || !websiteId) return false");
    expect(appSource).toContain('lazy(() => import("./pages/Home"))');
    expect(appSource).toContain("<Suspense");
    expect(homeSource).toContain(
      'lazy(() => import("@/components/WorkflowCanvas"))'
    );
    expect(homeSource).toContain(
      'import("@/components/OrganizationManagementPage")'
    );
    expect(homeSource).toContain(
      'import("@/components/ProjectWorkspace").then'
    );
    expect(packageSource).toContain('"check:bundle"');
    expect(packageSource).toContain("pnpm check:bundle");
    expect(bundleBudgetSource).toContain("maxChunkBytes = 450 * 1024");
    expect(bundleBudgetSource).toContain("maxTotalBytes = 1_341 * 1024");
    expect(bundleBudgetSource).toContain("maxTotalGzipBytes = 400 * 1024");
    expect(bundleBudgetSource).toContain("gzipSync(contents)");
    expect(bundleBudgetSource).toContain("maxHtmlBytes = 20 * 1024");
    expect(bundleBudgetSource).toContain('id="manus-runtime"');
    expect(bundleBudgetSource).toContain('"debug-collector.js"');
    expect(viteConfigSource).toContain("MANUS_RUNTIME_IN_PRODUCTION");
    expect(viteConfigSource).toContain('command === "serve"');
    expect(viteConfigSource).toContain('"/__manus__/debug-collector.js"');
  });

  it("新建流程通过按钮打开创建弹窗，控制台壳层可在窄屏纵向收敛", () => {
    expect(homeSource).toContain("setCreateFlowOpen(true)");
    expect(homeSource).toContain('title="新建流程"');
    expect(homeSource).toContain(
      "onSubmit={() => createFlow.mutate({ name: newFlowName })}"
    );
    expect(homeSource).toContain(
      "flex min-h-[calc(100vh-56px)] flex-col md:flex-row"
    );
    expect(homeSource).toContain('flowListOpen ? "w-full md:w-72"');
    expect(homeSource).toContain(
      "key={`${workflow.id}:${workflow.definitionVersion}`}"
    );
    expect(homeSource).not.toContain(
      "workflow.definitionVersion}:${JSON.stringify(definition).length"
    );
    expect(homeSource).toContain("trpc.workflow.unpublish.useMutation");
    expect(homeSource).toContain("取消发布");
    expect(homeSource).toContain("历史版本与运行审计已保留");
    expect(homeSource).toContain("StructuredRunInput");
    expect(homeSource).toContain("运行字段");
    expect(homeSource).toContain("添加运行字段");
    expect(homeSource).toContain("当前未填写运行字段");
    expect(homeSource).toContain("setRunInput({})");
    expect(homeSource).not.toContain('prompt: "请总结输入内容"');
    expect(homeSource).not.toContain("id: 2,");
    expect(homeSource).toContain("canRun={canRun}");
    expect(homeSource).not.toContain(
      'className="mt-2 h-20 w-full rounded border border-border bg-muted p-2 font-mono'
    );
  });

  it("统一新增入口为按钮触发弹窗，并仅在成功后关闭清理", () => {
    expect(creationDialogSource).toContain("data-aiflow-creation-dialog");
    expect(creationDialogSource).toContain("if (!pending) onOpenChange(next)");
    expect(creationDialogSource).toContain('type="button"');
    expect(creationDialogSource).toContain('variant="outline"');
    expect(creationDialogSource).toContain(
      'className="h-11 min-[1024px]:h-10"'
    );
    expect(creationDialogSource).toContain(
      "min-[1024px]:h-10 min-[1024px]:w-10"
    );
    expect(projectWorkspaceSource).not.toContain("text-sm sm:min-h-9");
    expect(creationDialogSource).toContain("<Dialog open={open}");
    expect(creationDialogSource).toContain("<DialogContent");
    expect(creationDialogSource).toContain("<DialogTitle");
    expect(creationDialogSource).toContain("<DialogDescription");
    expect(creationDialogSource).toContain("<DialogClose asChild");
    expect(creationDialogSource).not.toContain('role="dialog"');
    expect(creationDialogSource).toContain(
      "overflow-y-auto overscroll-contain"
    );
    expect(creationDialogSource).toContain(
      "aiflow-type-section-title font-semibold leading-6"
    );
    expect(creationDialogSource).toContain("aiflow-type-body mt-1 leading-5");
    expect(creationDialogSource).toContain("void onSubmit()");
    expect(homeSource).toContain(
      "const [normalDialogOpen, setNormalDialogOpen]"
    );
    expect(homeSource).toContain("const [aiDialogOpen, setAiDialogOpen]");
    expect(homeSource).toContain("await onCreate();");
    expect(homeSource).toContain("setNormalDialogOpen(false)");
    expect(homeSource).toContain("await onConfirmPreview(selected)");
    expect(homeSource).toContain("setAiDialogOpen(false)");
    expect(projectWorkspaceSource).toContain("<CreationDialog");
    expect(warehouseSource).toContain("<Dialog open={Boolean(folderDialog)}");
    expect(warehouseSource).toContain(
      "createFolder.mutate({ projectId: activeProjectId"
    );
    expect(dataResourceSource).toContain("<CreationDialog");
    expect(organizationPageSource).toContain("<CreationDialog");
  });

  it("业务与流程列表按视口切换布局并保持主次信息层级", () => {
    expect(projectWorkspaceSource).toContain(
      'className="hidden min-[900px]:block"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="grid gap-2 p-3 sm:grid-cols-2 sm:gap-3 min-[900px]:hidden"'
    );
    expect(projectWorkspaceSource).toContain("w-[36%] px-4 py-3");
    expect(projectWorkspaceSource).toContain("w-[16%] px-4 py-3 text-right");
    expect(projectWorkspaceSource).toContain("业务名称 / 代号");
    expect(projectWorkspaceSource).toContain("流程数");
    expect(projectWorkspaceSource).toContain("工作域");
    expect(projectWorkspaceSource).toContain("创建时间");
    expect(projectWorkspaceSource).toContain("rootDepartment");
    expect(projectWorkspaceSource).toContain(
      "<ProjectMoreDetails project={project} />"
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body grid gap-x-4 gap-y-2 sm:grid-cols-2"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body mt-3 grid grid-cols-2 gap-x-4 gap-y-2"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body px-4 py-3 text-right font-mono tabular-nums text-foreground"'
    );
    expect(projectWorkspaceSource).toContain("colSpan={5}");
    expect(projectWorkspaceSource).not.toContain(">序号</th>");
    expect(projectWorkspaceSource).not.toContain(">根部门</th>");
    expect(projectWorkspaceSource).toContain(
      'aria-label="搜索业务名称、代号或工作域"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-control h-11 min-[1280px]:h-9"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="w-full min-w-[960px] text-left"'
    );
    expect(projectWorkspaceSource).toContain(
      "flex items-center justify-end gap-2 whitespace-nowrap"
    );
    expect(projectWorkspaceSource).toContain(
      "aria-label={`更多信息与操作：${workflow.name}`}"
    );
    expect(projectWorkspaceSource).toContain(
      "const actionPopoverId = `${surface}:${workflow.id}`;"
    );
    expect(projectWorkspaceSource).toContain(
      "--radix-popover-content-available-height"
    );
    expect(projectWorkspaceSource).toContain(
      'renderMoreActions(workflow, "table")'
    );
    expect(projectWorkspaceSource).toContain(
      'renderMoreActions(workflow, "card")'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body mt-1 line-clamp-2 break-words text-muted-foreground"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body mt-2 line-clamp-2 break-words text-muted-foreground"'
    );
    expect(projectWorkspaceSource).toContain("workflowCode(workflow)");
    expect(projectWorkspaceSource).toContain(
      "h-11 min-h-11 flex-1 px-3 font-semibold"
    );
    expect(projectWorkspaceSource).toContain("未知审核状态（原值：${value}）");
    expect(projectWorkspaceSource).toContain("未知类型（原值：${value}）");
  });

  it("全站字号采用统一层级并收敛历史过小字号", () => {
    expect(styleSource).toContain("--aiflow-type-meta: 0.8125rem;");
    expect(styleSource).toContain("--aiflow-type-control: 0.875rem;");
    expect(styleSource).toContain("--aiflow-type-code: 0.875rem;");
    expect(styleSource).toContain("--aiflow-type-body: 1rem;");
    expect(styleSource).toContain("--aiflow-leading-code: 1.3125rem;");
    expect(styleSource).toContain("--aiflow-type-section: 1.125rem;");
    expect(styleSource).toContain("--aiflow-type-page-title: 1.5rem;");
    expect(styleSource).toContain("--aiflow-type-display: 1.75rem;");
    expect(styleSource).toContain("--aiflow-leading-meta: 1.125rem;");
    expect(styleSource).toContain("--aiflow-leading-control: 1.25rem;");
    expect(styleSource).toContain("--aiflow-leading-body: 1.5rem;");
    expect(styleSource).toContain("--aiflow-leading-section: 1.5625rem;");
    expect(styleSource).toContain("--aiflow-leading-page-title: 2rem;");
    expect(styleSource).toContain("--aiflow-leading-display: 2.1875rem;");
    expect(styleSource).toContain(
      "font-size: var(--aiflow-type-control) !important;"
    );
    expect(styleSource).toContain(
      ".aiflow-type-body { font-size: var(--aiflow-type-body) !important; line-height: var(--aiflow-leading-body) !important; }"
    );
    expect(styleSource).toContain(
      ".aiflow-type-control { font-size: var(--aiflow-type-control) !important; }"
    );
    expect(styleSource).toContain('label:not([class*="aiflow-type-"])');
    expect(styleSource).toContain('th:not([class*="aiflow-type-"])');
    expect(styleSource).toContain("[data-aiflow-page-title]");
    expect(styleSource).toContain(":is(h1, [data-aiflow-page-title])");
    expect(styleSource).toContain("h2 {");
    expect(styleSource).toContain(":is(h3, h4)");
    expect(styleSource).toContain(
      ":is(h2, h3, h4).aiflow-type-section-title, :is(h2, h3, h4).aiflow-type-card-title"
    );
    expect(styleSource).toContain(
      "font-size: var(--aiflow-type-section) !important;"
    );
    expect(styleSource).toContain("@media (max-width: 639px)");
    expect(styleSource).not.toContain("--aiflow-type-page-title: 1.25rem;");
    expect(homeSource).toContain('data-aiflow-page-title=""');
    expect(styleSource).toContain('class*="text-[9px]"');
    expect(styleSource).toContain('class*="text-[11px]"');
    expect(styleSource).toContain(
      "font-size: var(--aiflow-type-meta) !important;"
    );
    expect(styleSource).toContain(
      "line-height: var(--aiflow-leading-meta) !important;"
    );
    expect(styleSource).toContain('class*="text-[13px]"');
    expect(styleSource).toContain(
      "font-size: var(--aiflow-type-body) !important;"
    );
    expect(canvasSource).toContain("minZoom={0.1}");
    expect(canvasSource).toContain("lastInitialFitKeyRef");
    expect(canvasSource).toContain("minZoom: 0.1,");
    expect(canvasSource).toContain("maxZoom: 1.25,");
    expect(canvasSource).toContain("minZoom={0.1}");
    expect(canvasSource).toContain("maxZoom={1.25}");
    expect(canvasSource).toContain(
      "aiflow-type-body block truncate font-semibold text-foreground"
    );
  });

  it("角色详情弹窗避免重复标题并使用统一字号层级", () => {
    expect(homeSource).toContain("<DialogTitle>角色详情</DialogTitle>");
    expect(homeSource).toContain(
      '<DialogDescription className="aiflow-type-body leading-6">'
    );
    expect(homeSource).toContain("{!embedded && (");
    expect(homeSource).toContain(
      "aiflow-type-section-title break-words font-semibold text-foreground"
    );
    expect(homeSource).toContain(
      "aiflow-type-control h-11 min-h-11 shrink-0 bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10 min-[1024px]:min-h-10"
    );
  });

  it("节点与资源选择面板使用统一语义字号，不把说明缩成元数据", () => {
    const paletteStart = canvasSource.indexOf('data-flow-node-palette=""');
    const paletteEnd = canvasSource.indexOf(
      'data-flow-canvas-actions=""',
      paletteStart
    );
    const paletteSource = canvasSource.slice(paletteStart, paletteEnd);

    expect(paletteStart).toBeGreaterThanOrEqual(0);
    expect(paletteEnd).toBeGreaterThan(paletteStart);
    expect(paletteSource).toContain("aiflow-type-control inline-flex");
    expect(paletteSource).toContain("aiflow-type-meta rounded");
    expect(paletteSource).toContain(
      "aiflow-type-body mt-0.5 block line-clamp-2"
    );
    expect(paletteSource).toContain("aiflow-type-section-title mb-2");
    expect(paletteSource).not.toMatch(/text-\[(?:9|10|11)px\]|text-xs/);
  });

  it("窄屏流程画布控制提供44px触控目标，更多操作对齐右侧", () => {
    expect(canvasSource).toContain('className="flow-canvas-controls"');
    expect(styleSource).toContain(".flow-canvas-controls {");
    expect(styleSource).toContain("@media (max-width: 1023px)");
    expect(styleSource).toContain("flex-direction: row;");
    expect(styleSource).toContain("min-width: 44px;");
    expect(styleSource).toContain("min-height: 44px;");
    expect(homeSource).toContain(
      'className="ml-auto h-11 min-h-11 min-w-11 p-0 text-foreground'
    );
  });

  it("身份目录使用单一页面滚动和至少 40px 的桌面操作目标", () => {
    expect(homeSource).not.toContain(
      'className="p-2 min-[1024px]:max-h-[620px] min-[1024px]:overflow-y-auto"'
    );
    expect(homeSource).not.toContain(
      "min-[1024px]:max-h-[560px] min-[1024px]:overflow-y-auto"
    );
    expect(homeSource).toContain("min-[1024px]:h-10 min-[1024px]:w-10");
    expect(homeSource).toContain(
      "min-[1024px]:col-span-1 min-[1024px]:col-start-6 min-[1024px]:h-10 min-[1024px]:px-2"
    );
  });

  it("项目权限页说明文字与其他页面统一使用正文 14px token", () => {
    const permissionHeader = projectWorkspaceSource.slice(
      projectWorkspaceSource.indexOf("PROJECT AUTHORIZATION & ISOLATION"),
      projectWorkspaceSource.indexOf("可见部门列表（部门继承授权）")
    );
    expect(permissionHeader).toContain(
      'className="aiflow-type-body mt-1 text-muted-foreground"'
    );
    expect(
      projectWorkspaceSource.match(
        /className="aiflow-type-body leading-5 font-normal text-muted-foreground"/g
      )
    ).toHaveLength(2);
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body p-6 text-center text-muted-foreground"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body flex flex-col gap-1 border-b border-border bg-muted/70 px-4 py-3 font-semibold sm:flex-row sm:items-center sm:justify-between"'
    );
  });

  it("项目权限卡片优先呈现现有授权，并将添加表单折叠为按需操作", () => {
    const departmentGrant = projectWorkspaceSource.indexOf(
      'data-project-permission-grant="department"'
    );
    const departmentList = projectWorkspaceSource.indexOf(
      'data-project-permission-list="department"'
    );
    const memberGrant = projectWorkspaceSource.indexOf(
      'data-project-permission-grant="member"'
    );
    const memberList = projectWorkspaceSource.indexOf(
      'data-project-permission-list="member"'
    );

    expect(departmentGrant).toBeGreaterThan(-1);
    expect(departmentList).toBeGreaterThan(departmentGrant);
    expect(memberGrant).toBeGreaterThan(-1);
    expect(memberList).toBeGreaterThan(memberGrant);
    expect(
      projectWorkspaceSource.slice(departmentGrant, departmentList)
    ).toContain("<form");
    expect(projectWorkspaceSource.slice(memberGrant, memberList)).toContain(
      "<form"
    );
    expect(projectWorkspaceSource).toContain("<summary");
    expect(projectWorkspaceSource).toContain("添加部门授权</span>");
    expect(projectWorkspaceSource).toContain("添加成员授权</span>");
    expect(projectWorkspaceSource).not.toMatch(
      /<details\s+data-project-permission-grant="(?:department|member)"[^>]*\bopen\b/
    );
    expect(projectWorkspaceSource).toContain(
      "new Set(members.map(member => member.userId)).size"
    );
    expect(projectWorkspaceSource).toContain(
      "{(projectUnits.data ?? []).length} 个部门"
    );
  });

  it("项目权限成员列表使用统一字号并对授权撤销显示对象和影响范围确认", () => {
    expect(styleSource).toContain("--aiflow-type-body: 1rem;");
    expect(styleSource).toContain("--aiflow-type-meta: 0.8125rem;");
    expect(styleSource).toContain("--aiflow-type-section: 1.125rem;");
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-page-title mt-1 font-semibold text-foreground"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-meta mt-0.5 font-mono text-muted-foreground"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-meta mt-0.5 text-muted-foreground"'
    );
    expect(projectWorkspaceSource).toContain(
      "aria-label={`移除成员授权：${member.name || member.username}（${member.username}）`}"
    );
    expect(projectWorkspaceSource).toContain(
      "aria-label={`移除部门授权：${item.unitName || item.unitCode}（${item.unitCode}）`}"
    );
    expect(projectWorkspaceSource).toContain(
      "AlertDialogTitle>确认移除项目授权</AlertDialogTitle>"
    );
    expect(projectWorkspaceSource).toContain(
      "若该成员仍通过部门继承授权，项目访问可能继续有效。"
    );
    expect(projectWorkspaceSource).toContain(
      "成员若仍有直接授权或其他部门授权，项目访问可能继续有效。"
    );
    expect(projectWorkspaceSource).toContain(
      "min-h-11 items-center gap-1.5 rounded px-2.5 font-medium text-aiflow-danger"
    );
    expect(projectWorkspaceSource).not.toContain(
      "revokeMember.mutate({ projectId, userId: member.userId })"
    );
    expect(projectWorkspaceSource).not.toContain(
      "revokeUnit.mutate({ projectId, unitId: item.unitId })"
    );
  });

  it("业务创建把工作域状态和访问范围保护说明保持为正文档", () => {
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body font-normal text-muted-foreground"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body font-normal text-aiflow-warning"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body rounded border border-aiflow-info-border bg-aiflow-info-surface/60 p-2.5 text-muted-foreground"'
    );
    expect(projectWorkspaceSource).not.toContain(
      "text-[11px] leading-5 text-muted-foreground"
    );
  });

  it("目录授权使用可搜索多选、明确加载失败态并按权限限定人员查询", () => {
    expect(projectWorkspaceSource).toContain("<SearchableMultiSelect");
    expect(projectWorkspaceSource).toContain("添加可见部门（可多选");
    expect(projectWorkspaceSource).toContain("支持同时选择多人");
    expect(projectWorkspaceSource).toContain("DirectoryRetry");
    expect(projectWorkspaceSource).toContain("searchActiveUsers.useQuery");
    expect(projectWorkspaceSource).toContain("searchActiveUnits.useQuery");
    expect(projectServiceSource).toContain(
      'hasSystemPermission(user, "workflow:create")'
    );
    expect(projectServiceSource).toContain("project:manage");
    expect(projectServiceSource).toContain("LIMIT 51");
    expect(projectServiceSource).toContain(
      "SELECT id, username, name FROM users"
    );
    expect(projectServiceSource).not.toContain(
      "SELECT id, username, name, email FROM users WHERE status='active' ORDER BY username"
    );
    expect(routerSource).toContain("searchActiveUsers:");
    expect(routerSource).toContain("searchActiveUnits:");
    expect(routerSource).toContain("z.string().trim().min(1).max(80)");
  });

  it("业务列表把首次加载、失败、刷新失败和成功空结果分开呈现", () => {
    const businessCenterStart = homeSource.indexOf("<BusinessCenter");
    const businessCenterEnd = homeSource.indexOf("/>", businessCenterStart);
    const businessCenterUsage = homeSource.slice(
      businessCenterStart,
      businessCenterEnd
    );

    expect(businessCenterStart).toBeGreaterThanOrEqual(0);
    expect(businessCenterEnd).toBeGreaterThan(businessCenterStart);
    expect(homeSource).toContain(
      "projects.isLoading && projects.data === undefined"
    );
    expect(homeSource).toContain("data-business-list-loading");
    expect(homeSource).toContain(
      "projects.isError && projects.data === undefined"
    );
    expect(homeSource).toContain("data-business-list-error");
    expect(homeSource).toContain("projects.refetch()");
    expect(homeSource).toContain("data-business-list-stale");
    expect(businessCenterUsage).toContain(
      "projects={projects.data as ProjectRecord[]}"
    );
    expect(businessCenterUsage).not.toContain(
      "projects={(projects.data ?? []) as ProjectRecord[]}"
    );
    expect(projectWorkspaceSource).toContain(
      "没有符合条件的业务项目。请调整筛选条件，或重置筛选。"
    );
  });

  it("保留原始流程创建的代号、来源和项目数据源结构化字段", () => {
    expect(projectWorkspaceSource).toContain(
      'placeholder="例如 ORDER_APPROVAL"'
    );
    expect(projectWorkspaceSource).toContain("手工创建");
    expect(projectWorkspaceSource).toContain("从仓库导入");
    expect(projectWorkspaceSource).toContain("不关联数据源");
    expect(projectWorkspaceSource).toContain("流程代号在当前业务内唯一");
    expect(projectWorkspaceSource).toContain(
      "workflow.processCode || String(workflow.id)"
    );
    expect(warehouseSource).toContain('creationSource: "warehouse"');
    expect(warehouseSource).toContain("processCode:");
  });

  it("流程中心把关联数据源留在按需详情，不挤占默认列表列", () => {
    expect(projectWorkspaceSource).toContain("关联数据源");
    expect(projectWorkspaceSource).toContain(
      "const sourceNameById = new Map( dataSources.map"
    );
    expect(projectWorkspaceSource).toContain(
      'workflow.flowType !== "data" ? "不适用"'
    );
    expect(projectWorkspaceSource).toContain("已关联数据源");
    expect(projectWorkspaceSource).toContain("未关联");
    expect(projectWorkspaceSource).toContain(
      '{renderMoreActions(workflow, "table")}'
    );
    expect(projectWorkspaceSource).toContain(
      '{renderMoreActions(workflow, "card")}'
    );
    expect(projectWorkspaceSource).toContain(
      'workflow.status === "published" ? onLaunch(workflow) : onOpenWorkflow(workflow.id)'
    );
    expect(projectWorkspaceSource).toContain(
      'workflow.status === "published" ? workflow.flowType === "data" ? "执行" : "发起" : "设计"'
    );
    expect(projectWorkspaceSource).not.toContain(
      '▾</span> <span aria-hidden="true">▾'
    );
    expect(projectWorkspaceSource).toContain("colSpan={6}");
  });

  it("流程仓库支持键盘搜索项目代号和名称，并限制大列表渲染量", () => {
    const pickerStart = warehouseSource.indexOf('role="combobox"');
    const pickerEnd = warehouseSource.indexOf("</Popover>", pickerStart);
    const projectPickerSource = warehouseSource.slice(pickerStart, pickerEnd);

    expect(warehouseSource).toContain(
      "切换流程仓库项目，当前：${currentProject.code}"
    );
    expect(warehouseSource).toContain('role="combobox"');
    expect(warehouseSource).toContain('aria-label="搜索仓库项目"');
    expect(warehouseSource).toContain("输入项目名称或代号搜索");
    expect(warehouseSource).toContain(
      "searchSelectOptions(projectOptions, projectQuery, 50)"
    );
    expect(warehouseSource).toContain("显示前 50 个匹配项目");
    expect(warehouseSource).toContain('className="min-h-11"');
    expect(warehouseSource).toContain(
      'className="aiflow-type-card-title min-w-0 break-words font-semibold leading-6 text-foreground"'
    );
    expect(warehouseSource).not.toContain(
      'className="aiflow-type-body min-w-0 truncate font-semibold leading-5 text-foreground"'
    );
    expect(warehouseSource).toContain("setSelectedFolderId(null)");
    expect(warehouseSource).toContain("setSelectedWorkflowId(null)");
    expect(projectPickerSource).not.toContain("<select");
  });

  it("窄屏打开仓库流程预览时定位内容与焦点，返回后恢复到原条目", () => {
    expect(warehouseSource).toContain("workflowRowRefs");
    expect(warehouseSource).toContain("workflowPreviewRef");
    expect(warehouseSource).toContain("returnToWorkflowListRef");
    expect(warehouseSource).toContain(
      'window.matchMedia("(max-width: 1279px)").matches'
    );
    expect(warehouseSource).toContain(
      'workflowPreviewRef.current?.scrollIntoView({ block: "start" })'
    );
    expect(warehouseSource).toContain(
      'previousRow?.scrollIntoView({ block: "center" })'
    );
    expect(warehouseSource).toContain("focus({ preventScroll: true })");
    expect(warehouseSource).toContain('aria-label="返回流程列表"');
  });

  it("保留仓库上传仅适用于状态和控制流程的类型边界", () => {
    expect(warehouseSource).toContain(
      "数据流程不支持从流程仓库导入，请在数据资源中心独立设计和运行。"
    );
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
    expect(projectWorkspaceSource).toContain(
      "trpc.project.workflowAudit.useQuery"
    );
    expect(projectWorkspaceSource).toContain(
      "仅展示当前业务内所选流程的审核与审核重置审计"
    );
    expect(projectWorkspaceSource).toContain("正在读取审批记录…");
    expect(projectWorkspaceSource).toContain("审核通过");
    expect(projectWorkspaceSource).toContain("审核驳回");
    expect(projectWorkspaceSource).toContain("重置审核状态");
  });

  it("项目审批记录选择器在窄屏视口内定位并保持可访问展开状态", () => {
    expect(projectWorkspaceSource).toContain("approvalSelectorOpen");
    expect(projectWorkspaceSource).toContain("<PopoverTrigger asChild>");
    expect(projectWorkspaceSource).toContain(
      "aria-expanded={approvalSelectorOpen}"
    );
    expect(projectWorkspaceSource).toContain('align="start"');
    expect(projectWorkspaceSource).toContain('side="bottom"');
    expect(projectWorkspaceSource).toContain("collisionPadding={12}");
    expect(projectWorkspaceSource).toContain(
      "w-[min(18rem,calc(100vw-1.5rem))] p-3"
    );
    expect(projectWorkspaceSource).toContain("setApprovalSelectorOpen(false)");
    expect(projectWorkspaceSource).toContain("选择流程查看审批记录");
  });

  it("恢复原始项目工作区的受权业务选择控件和切换状态清理", () => {
    expect(homeSource).toContain("data-aiflow-business-selector");
    expect(homeSource).toContain("切换当前受权业务");
    expect(homeSource).toContain("仅显示当前账号具备查看权限的业务项目");
    expect(homeSource).toContain(
      'className="aiflow-type-control h-11 min-h-11'
    );
    expect(homeSource).toMatch(
      /<span className="aiflow-type-meta text-muted-foreground lg:text-right">\s*仅显示当前账号具备查看权限的业务项目/
    );
    expect(homeSource).toContain(
      "lg:flex-row lg:items-center lg:justify-between"
    );
    expect(homeSource).toContain("max-w-[min(560px,calc(100vw-110px))]");
    expect(homeSource).toContain("setSelectedWorkflowId(null)");
    expect(projectWorkspaceSource).toContain('setView("process")');
    expect(projectWorkspaceSource).toContain("setFilters({})");
    expect(projectWorkspaceSource).not.toContain("detailWorkflowId");
  });

  it("业务切换可搜索且日历按本地月区间和授权游标继续加载", () => {
    expect(homeSource).toContain("切换当前受权业务");
    expect(homeSource).toContain("搜索业务名称或代号");
    expect(homeSource).toContain("value={`${project.code} ${project.name}`}");
    expect(homeSource).toContain("仅显示当前账号具备查看权限的业务项目");

    expect(processWorkbenchSource).toContain(
      "start: new Date(month.getFullYear(), month.getMonth(), 1)"
    );
    expect(processWorkbenchSource).toContain(
      "end: new Date(month.getFullYear(), month.getMonth() + 1, 1)"
    );
    expect(processWorkbenchSource).toContain("CALENDAR_DAY_PREVIEW_LIMIT");
    expect(processWorkbenchSource).toContain(
      "const visibleDayEvents = dayEvents.slice(0, visibleEventLimit)"
    );
    expect(processWorkbenchSource).toContain(
      "const dayKey = calendarDayKey(day)"
    );
    expect(processWorkbenchSource).toContain(
      "dayEvents.length - visibleDayEvents.length"
    );
    expect(processWorkbenchSource).toContain("calendarCursorStack");
    expect(processWorkbenchSource).toContain("载入更多任务");
    expect(processWorkbenchSource).toContain(
      "此日历按任务创建时间归档，不表示计划办理日或截止日。"
    );
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-body min-w-0 text-muted-foreground"'
    );
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-body mb-2 text-muted-foreground"'
    );
    expect(processWorkbenchSource).toContain("visibleSelectedEvents");
    expect(routerSource).toContain("start: z.coerce.date()");
    expect(routerSource).toContain("cursor: z.string().max(512).optional()");
    expect(p1ServiceSource).toContain("createdAtFrom?: Date");
    expect(p1ServiceSource).toContain("createdAtBefore?: Date");
    expect(p1ServiceSource).toContain("t.createdAt>=?");
    expect(p1ServiceSource).toContain("t.createdAt<?");
    expect(p1ServiceSource).toContain("start: task.createdAt");
    expect(p1ServiceSource).toContain("cursor: range.cursor");
  });

  it("系统配置导航使用路径语义并关联当前内容标题", () => {
    expect(systemConfigSource).toContain('id="system-config-active-tab"');
    expect(systemConfigSource).toContain('aria-label="系统配置路径"');
    expect(systemConfigSource).toContain('id="system-config-card"');
    expect(systemConfigSource).toContain(
      'aria-labelledby="system-config-active-tab"'
    );
    expect(systemConfigSource).not.toContain('role="tablist"');
    expect(systemConfigSource).not.toContain('role="tabpanel"');
    expect(systemConfigSource).toContain(
      "flex h-11 min-w-0 items-center gap-2 rounded px-3 text-left text-sm min-[1024px]:h-10"
    );
  });

  it("组织架构从系统配置进入独立安全页面，并以弹窗提交真实接口", () => {
    expect(consoleRouteSource).toContain(
      'view: "config" | "identity" | "organization"'
    );
    expect(consoleRouteSource).toContain(
      'if (route.view === "organization") return "#/system/organization"'
    );
    expect(homeSource).toContain("OrganizationManagementPage");
    expect(homeSource).toContain('view: "organization"');
    expect(systemConfigSource).toContain("打开组织架构管理");
    expect(systemConfigSource).toContain("onOpenOrganization");
    expect(systemConfigSource).toContain(
      '{ id: "access" as const, label: "组织与权限"'
    );
    expect(systemConfigSource).not.toContain('{ id: "organization" as const');
    expect(systemConfigSource).not.toContain('{ id: "identity" as const');
    expect(systemConfigSource).toContain(
      "组织、账号、角色和权限统一从一个入口管理"
    );
    expect(systemConfigSource).toContain("打开身份与权限中心");
    expect(organizationPageSource).toContain(
      'data-aiflow-organization-page=""'
    );
    expect(organizationPageSource).toContain("新增根部门");
    expect(organizationPageSource).toContain("新增同级");
    expect(organizationPageSource).toContain("新增子部门");
    expect(organizationPageSource).toContain("新增部门");
    expect(organizationPageSource).toContain('aria-label="更多部门操作"');
    expect(organizationPageSource).toContain(
      "aria-label={`查看成员权限来源：${memberIdentity}`}"
    );
    expect(organizationPageSource).toContain(
      "aria-label={`更多成员操作：${memberIdentity}`}"
    );
    expect(organizationPageSource).toContain(
      "aria-label={`从当前部门移除成员：${memberIdentity}`}"
    );
    expect(organizationPageSource).toContain(
      'className="aiflow-type-control flex h-11 items-center gap-2 rounded px-2 text-left text-foreground hover:bg-muted disabled:opacity-50 min-[1024px]:h-10"'
    );
    expect(organizationPageSource).not.toContain(
      "text-left text-xs text-foreground"
    );
    expect(organizationPageSource).toContain("停用部门");
    expect(organizationPageSource).toContain("删除部门…");
    expect(organizationPageSource).toContain(
      'selected && !mobileDirectoryOpen ? "hidden lg:block" : ""'
    );
    expect(organizationPageSource).toContain("setMobileDirectoryOpen(true)");
    expect(organizationPageSource).toContain("部门路径");
    expect(organizationPageSource).toContain(
      'className="mt-4 grid grid-cols-1 gap-2 min-[448px]:grid-cols-2 xl:grid-cols-3"'
    );
    expect(organizationPageSource).toContain(
      'className="aiflow-type-body mt-1 break-words font-medium text-foreground"'
    );
    expect(organizationPageSource).toContain("renderMemberActions(member)");
    expect(organizationPageSource).toContain("部门概览");
    expect(organizationPageSource).toContain("成员与岗位");
    expect(organizationPageSource).toContain("权限组");
    expect(organizationPageSource).toContain(
      "createOrganizationUnit.useMutation"
    );
    expect(organizationPageSource).toContain(
      "assignOrganizationMember.useMutation"
    );
    expect(organizationPageSource).toContain(
      "bindOrganizationRole.useMutation"
    );
    expect(organizationPageSource).toContain("取消保留原有信息");
    expect(organizationPageSource).toContain(
      "moveOrganizationMember.useMutation"
    );
    expect(organizationPageSource).toContain(
      "setPrimaryOrganizationMembership.useMutation"
    );
    expect(organizationPageSource).toContain(
      "deleteOrganizationUnit.useMutation"
    );
    expect(organizationPageSource).toContain("createUser.useMutation");
    expect(organizationPageSource).toContain("新建内部用户");
    expect(organizationPageSource).toContain("包含子机构成员");
    expect(organizationPageSource).toContain("用户直接角色");
    expect(organizationPageSource).toContain("部门继承角色");
    expect(organizationPageSource).toContain("没有匹配的机构");
    expect(organizationPageSource).toContain(
      'className="mt-1 break-all font-mono'
    );
    expect(organizationPageSource).toContain("max-w-[220px] break-words");
    expect(organizationPageSource).toContain("max-w-full break-all");
  });

  it("组织与权限同级入口使用相同卡片、标题字号和按钮层级", () => {
    const accessSettingsSource = systemConfigSource.slice(
      systemConfigSource.indexOf("function AccessSettings("),
      systemConfigSource.indexOf("function Header(")
    );
    expect(accessSettingsSource).toContain(
      '"flex min-w-0 flex-col rounded-lg border border-border bg-card p-5"'
    );
    expect(accessSettingsSource).toContain(
      '"mt-5 h-11 w-fit border-border text-foreground hover:bg-muted min-[1024px]:h-10"'
    );
    expect(
      accessSettingsSource.match(/className=\{accessCardClassName\}/g)
    ).toHaveLength(2);
    expect(
      accessSettingsSource.match(/className=\{accessCardActionClassName\}/g)
    ).toHaveLength(2);
    expect(accessSettingsSource.match(/variant="outline"/g)).toHaveLength(2);
    expect(accessSettingsSource.match(/aiflow-type-card-title/g)).toHaveLength(
      2
    );
    expect(accessSettingsSource).not.toContain("bg-blue-600");
  });

  it("组织成员和权限信息按统一字号角色显示", () => {
    expect(organizationPageSource).toContain(
      'className="aiflow-type-page-title mt-1 font-semibold text-foreground"'
    );
    expect(organizationPageSource).toContain(
      'className="aiflow-type-body mt-1 break-words text-muted-foreground"'
    );
    expect(organizationPageSource).toContain(
      'className="aiflow-type-card-title break-words font-semibold text-foreground"'
    );
    expect(organizationPageSource).toContain(
      'className="aiflow-type-body mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground"'
    );
    expect(organizationPageSource).toContain(
      'className="aiflow-type-body break-words leading-5 text-muted-foreground"'
    );
    expect(organizationPageSource).toContain(
      'className="aiflow-type-meta mt-0.5 break-all text-muted-foreground"'
    );
    expect(organizationPageSource).toContain(
      'className="aiflow-type-body mt-1 text-muted-foreground"'
    );
  });

  it("组织成员使用服务端筛选和可见总数的稳定分页", () => {
    expect(organizationPageSource).toContain(
      "trpc.config.organizationDirectory.useQuery"
    );
    expect(organizationPageSource).toContain(
      "trpc.config.organizationMembersPage.useQuery"
    );
    expect(organizationPageSource).toContain("pageSize: 20");
    expect(organizationPageSource).toContain('aria-label="成员分页"');
    expect(organizationPageSource).toContain("显示 {memberPageInfo.from}–");
    expect(organizationPageSource).not.toContain("members.filter(member => {");
    expect(routerSource).toContain(
      "organizationMembersPage: iamManageProcedure"
    );
    expect(routerSource).toContain("listOrganizationMembersPage(input)");
  });

  it("组织账号选择按需搜索有效用户，避免加载完整账号目录", () => {
    const organizationUserSelectorSource = organizationPageSource.slice(
      organizationPageSource.indexOf("function OrganizationUserSelect(")
    );
    expect(organizationPageSource).toContain("trpc.iam.userDirectory.useQuery");
    expect(organizationPageSource).toContain('status: "active"');
    expect(organizationPageSource).toContain("limit: 20");
    expect(organizationPageSource).toContain("enabled && open");
    expect(organizationPageSource).toContain("输入姓名、登录名或邮箱开始搜索");
    expect(organizationPageSource).toContain("请继续输入以缩小范围");
    expect(organizationPageSource).not.toContain("trpc.iam.users.useQuery");
    expect(organizationPageSource).not.toContain("activeUsers.map");
    expect(organizationUserSelectorSource).toContain("aiflow-type-control");
    expect(organizationUserSelectorSource).toContain("aiflow-type-body");
    expect(organizationUserSelectorSource).toContain("aiflow-type-meta");
    expect(commandSource).toContain('className="flex h-11 items-center gap-2');
    expect(commandSource).toContain(
      "aiflow-type-control placeholder:text-muted-foreground"
    );
    expect(commandSource).toContain("aiflow-type-body data-[selected=true]");
    expect(organizationPageSource).not.toContain("assignedUserIds");
    expect(organizationServiceSource).toContain(
      "unassignedActiveUserCount: Number("
    );
    expect(organizationServiceSource).toContain(
      "SELECT COUNT(*) AS unassignedCount FROM users u"
    );
    expect(organizationServiceSource).not.toContain(
      "SELECT DISTINCT userId FROM organization_membership"
    );
    expect(routerSource).toContain(
      'status: z.enum(["active", "disabled"]).optional()'
    );
    expect(internalAuthSource).toContain('conditions.join(" AND ")');
    expect(internalAuthSource).toContain(
      "ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?"
    );
  });

  it("运行诊断的能力名称与说明使用正文档，分组和元数据保留独立层级", () => {
    const runtimeStatusSource = systemConfigSource.slice(
      systemConfigSource.indexOf("function RuntimeStatus()"),
      systemConfigSource.indexOf("type ReadinessStatus")
    );
    expect(runtimeStatusSource).toContain(
      'className="aiflow-type-section-title font-semibold text-foreground"'
    );
    expect(runtimeStatusSource).toContain(
      'className="mt-1 text-sm text-muted-foreground"'
    );
    expect(
      runtimeStatusSource.match(
        /className="mt-2 text-sm leading-5 text-muted-foreground"/g
      )
    ).toHaveLength(3);
    expect(runtimeStatusSource).toContain(
      'className="mt-2 space-y-1 text-sm leading-5 text-aiflow-danger"'
    );
    expect(runtimeStatusSource).toContain(
      'className="min-w-0 break-words text-sm font-semibold text-foreground"'
    );
    expect(runtimeStatusSource).toContain(
      'className="text-sm leading-5 text-muted-foreground"'
    );
    expect(runtimeStatusSource).toContain(
      'className="p-4 text-sm text-muted-foreground"'
    );
    expect(runtimeStatusSource).toContain("技术详情 · 构建、迁移与环境身份");
    expect(styleSource).toContain(
      "@media (min-width: 440px) and (max-width: 639px)"
    );
    expect(styleSource).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr)) !important;"
    );
    expect(styleSource).toContain("grid-column: 1 / -1;");
  });

  it("内部账号中心支持 AI 批量预览、确认创建和用户角色双向查看", () => {
    expect(homeSource).toContain("AI 辅助批量创建");
    expect(homeSource).toContain("previewUserBatch.useMutation");
    expect(homeSource).toContain("createUsersBatch.useMutation");
    expect(homeSource).toContain("密码不会发送给模型");
    expect(homeSource).toContain("即将创建的用户");
    expect(homeSource).toContain('id: "users", label: "用户账号"');
    expect(homeSource).toContain('id: "roles", label: "角色与权限"');
    expect(homeSource).toContain('id: "audit", label: "授权审计"');
    expect(homeSource).toContain("userAuthorizationDetails.useQuery");
    expect(homeSource).toContain("roleAuthorizationDetails.useQuery");
    expect(homeSource).toContain("直接绑定用户");
    expect(homeSource).toContain("组织继承用户");
    expect(homeSource).toContain("data-iam-user-workbench");
    expect(homeSource).toContain("data-iam-role-workbench");
    expect(homeSource).toContain("data-iam-account-create-menu");
    expect(homeSource).toContain('data-iam-user-row=""');
    expect(homeSource).toContain("data-iam-user-more-actions");
    expect(homeSource).toContain('data-iam-account-status-action=""');
    expect(homeSource).toContain('data-iam-role-row=""');
    expect(homeSource).toContain(
      "aria-label={`查看角色详情：${role.name}（${role.code}）`}"
    );
    expect(homeSource).toContain("查看权限与角色");
    expect(homeSource).toContain("新增单个账号");
    expect(homeSource).toContain(
      "aiflow-type-meta min-w-0 break-words font-mono font-semibold text-aiflow-info"
    );
    expect(homeSource).toContain(
      "aiflow-type-meta shrink-0 rounded-full bg-card px-1.5 py-0.5 text-muted-foreground"
    );
    expect(homeSource).toContain(
      "aiflow-type-control flex h-11 min-w-0 items-center justify-center gap-1 border-b-2 px-1 text-center min-[640px]:gap-2 min-[640px]:px-3 min-[1024px]:h-10"
    );
    expect(homeSource).toContain(
      "aiflow-type-control h-11 min-h-11 min-w-0 rounded-md border border-border bg-card px-2 min-[1024px]:h-10 min-[1024px]:min-h-0"
    );
    expect(homeSource).toContain(
      'className="aiflow-type-body font-normal text-muted-foreground"'
    );
    expect(homeSource).toContain(
      'className="aiflow-type-control ml-2 inline-flex min-h-11 items-center px-1 underline min-[1024px]:min-h-0"'
    );
    expect(homeSource).toContain(
      'className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground"'
    );
    expect(homeSource).toContain('aria-label="搜索用户"');
    expect(homeSource).toContain('aria-label="搜索角色"');
    expect(homeSource).toContain(
      "aiflow-type-body mt-0.5 break-words font-medium text-foreground [overflow-wrap:anywhere]"
    );
    expect(homeSource).toContain(
      "filteredUsers.some(account => Number(account.id) === selectedUserId)"
    );
    expect(homeSource).toContain(
      "filteredRoles.some(role => Number(role.id) === selectedRoleId)"
    );
    expect(homeSource).toContain("assignSystemRole.useMutation");
    expect(homeSource).toContain("revokeRoleAssignment.useMutation");
    expect(homeSource).toContain("为用户绑定角色");
    expect(homeSource).toContain("为角色绑定用户");
    expect(homeSource).toContain("min-[640px]:hidden");
    expect(homeSource).toContain("hidden min-[640px]:inline");
    expect(iamServiceSource).toContain("请勿重复绑定");
    expect(routerSource).toContain("previewUserBatch: iamManageProcedure");
    expect(routerSource).toContain("createUsersBatch: iamManageProcedure");
    expect(routerSource).toContain(
      "userAuthorizationDetails: iamManageProcedure"
    );
    expect(routerSource).toContain(
      "roleAuthorizationDetails: iamManageProcedure"
    );
  });

  it("授权审计在窄屏保留卡片并完整显示操作者与对象", () => {
    expect(homeSource).toContain(
      "grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border bg-muted/60 p-3 min-[1024px]:grid-cols-[minmax(180px,1fr)_140px_auto_auto]"
    );
    expect(homeSource).toContain(
      "min-[1024px]:grid-cols-[150px_minmax(130px,1fr)_minmax(150px,1fr)_minmax(150px,1.1fr)_80px_90px]"
    );
    expect(homeSource).toContain("data-iam-audit-date-filter");
    expect(homeSource).toContain("日期范围");
    expect(homeSource).toContain("w-[min(23rem,calc(100vw-4rem))]");
    expect(homeSource).toContain("min-[1024px]:left-auto min-[1024px]:right-0");
    expect(homeSource).toContain('aria-label="审计起始日期"');
    expect(homeSource).toContain('aria-label="审计结束日期"');
    expect(homeSource).toContain(
      'aria-label={`${expanded ? "收起" : "查看"}授权审计事件：${auditActionLabel(item.action)}；${item.actorUsername || "系统"} → ${item.targetUsername || "—"}；记录 ${item.id}`}'
    );
    expect(homeSource).toContain(
      'className="aiflow-type-control col-span-2 h-11 justify-self-start px-3 text-aiflow-info min-[1024px]:col-span-1 min-[1024px]:col-start-6 min-[1024px]:h-10 min-[1024px]:px-2"'
    );
    expect(homeSource).toContain(
      'className="aiflow-type-control inline-flex min-h-11 shrink-0 items-center px-2 text-aiflow-info hover:underline min-[1024px]:min-h-0 min-[1024px]:px-0"'
    );
    expect(homeSource).toContain(
      "aria-label={`日期筛选，已应用 ${Number(Boolean(auditFrom)) + Number(Boolean(auditTo))} 项`}"
    );
    expect(homeSource).toContain(
      'className="aiflow-type-body grid min-w-0 grid-cols-2'
    );
    expect(homeSource).toContain(
      'className="col-span-2 min-w-0 min-[1024px]:col-span-1 min-[1024px]:col-start-2"'
    );
    expect(homeSource).toContain(
      'className="block break-words text-foreground [overflow-wrap:anywhere]"'
    );
    expect(homeSource).toContain("aiflow-type-section-title flex items-center");
    expect(homeSource).toContain("aiflow-type-meta text-muted-foreground");
    expect(homeSource).toContain(
      "aiflow-type-body mt-0.5 break-words text-foreground"
    );
  });

  it("实例详情按操作时间倒序展示必要字段，其余字段点击后以列表查看", () => {
    expect(instanceDetailSource).toContain("sortInstanceActions");
    expect(instanceDetailSource).toContain("operationTimestamp(right.action)");
    expect(instanceDetailSource).toContain("rightSequence - leftSequence");
    expect(instanceDetailSource).toContain("definitionNodeOrder");
    expect(instanceDetailSource).toContain(
      "默认仅展示必要字段，并按操作时间倒序排列"
    );
    expect(instanceDetailSource).toContain("data-instance-action-list");
    expect(instanceDetailSource).toContain("查看详情");
    expect(instanceDetailSource).toContain("flattenInstanceFields");
    expect(instanceDetailSource).toContain('title="节点输入"');
    expect(instanceDetailSource).toContain('title="节点输出"');
    expect(instanceDetailSource).toContain("当前业务状态");
    expect(instanceDetailSource).toContain("状态迁移历史");
    expect(instanceDetailSource).toContain("stateTransitions");
    expect(instanceDetailSource).not.toContain("JSON.stringify");
  });

  it("保留原始顶层四页签与当前流程工作台内容区域关联", () => {
    expect(homeSource).toContain(
      'role="tablist" aria-label="流程工作台主导航"'
    );
    expect(homeSource).toContain("id={`aiflow-console-tab-${item.id}`}");
    expect(homeSource).toContain('aria-controls="aiflow-console-panel"');
    expect(homeSource).toContain("aria-selected={section === item.id}");
    expect(homeSource).toContain(
      'id="aiflow-console-panel" tabIndex={-1} role="tabpanel"'
    );
    expect(homeSource).toContain(
      "aria-labelledby={`aiflow-console-tab-${section}`}"
    );
  });

  it("提供键盘跳转、全局可见焦点和登录错误摘要", () => {
    expect(homeSource).toContain('className="aiflow-skip-link"');
    expect(homeSource).toContain('href="#aiflow-console-panel"');
    expect(homeSource).toContain('id="aiflow-console-panel" tabIndex={-1}');
    expect(homeSource).toContain('role="alert" aria-live="assertive"');
    expect(homeSource).toContain('role="status" aria-live="polite"');
    expect(styleSource).toContain(":focus-visible {");
    expect(styleSource).toContain("outline: 3px solid #2563eb;");
    expect(styleSource).toContain(".aiflow-skip-link:focus-visible");
    expect(appSource).toContain('role="status" aria-live="polite"');
  });

  it("组织选择和成员列表使用完整名称路径与编码路径", () => {
    expect(organizationPageSource).toContain("unit.displayPath");
    expect(organizationPageSource).toContain("member.unitDisplayPath");
    expect(organizationPageSource).toContain('label="完整组织路径"');
  });

  it("保留顶层与子页面哈希路由同步、异步权限恢复和安全回退", () => {
    expect(consoleRouteSource).toContain(
      "export const consoleSections: ConsoleSection[]"
    );
    expect(consoleRouteSource).toContain(
      '"flows", "runs", "warehouse", "system"'
    );
    expect(consoleRouteSource).toContain(
      "export function parseConsoleRoute(hash: string): ConsoleRoute"
    );
    expect(consoleRouteSource).toContain(
      "export function formatConsoleRoute(route: ConsoleRoute): string"
    );
    expect(consoleRouteSource).toContain(
      'view: "workspace"; projectId: string'
    );
    expect(consoleRouteSource).toContain(
      'view: "detail" | "editor"; workflowId: string'
    );
    expect(consoleRouteSource).toContain(
      'view: "monitor"; workflowId: string; runId?: string'
    );
    expect(homeSource).toContain("const [requestedRoute, setRequestedRoute]");
    expect(homeSource).toContain("!workflows.isSuccess || !projects.isSuccess");
    expect(homeSource).toContain(
      "!selectedWorkflowFromList && selectedWorkflowQuery.isPending"
    );
    expect(homeSource).toContain(
      'if (!workflow || workflow.id !== route.workflowId) { replaceWith({ section: "flows", view: "center" })'
    );
    expect(homeSource).toContain("data-aiflow-route-restoring");
    expect(homeSource).toContain(
      'if (user.role !== "admin") { replaceWith({ section: "flows", view: "center" })'
    );
    expect(homeSource).toContain("const navigateSection = useCallback");
    expect(homeSource).toContain(
      'window.history[options?.replace ? "replaceState" : "pushState"]'
    );
    expect(homeSource).toContain(
      'window.addEventListener("popstate", restoreConsoleRoute)'
    );
    expect(homeSource).toContain(
      'window.addEventListener("hashchange", restoreConsoleRoute)'
    );
  });

  it("设计器按真实来源返回，并将运行监控作为已启动流程的同级页签", () => {
    expect(homeSource).toContain(
      'type FlowEditorReturn = "center" | "workspace" | "detail" | "warehouse"'
    );
    expect(homeSource).toContain("const openFlowEditor = useCallback");
    expect(homeSource).toContain("const returnFromFlowEditor = useCallback");
    expect(homeSource).toContain('openFlowEditor(workflowId, "workspace")');
    expect(homeSource).toContain('openFlowEditor(selectedId, "detail")');
    expect(homeSource).toContain('openFlowEditor(workflowId, "warehouse")');
    expect(homeSource).toContain("backLabel={flowEditorReturnLabel}");
    expect(homeSource).toContain('aria-label="已启动流程视图"');
    expect(homeSource).toContain('aria-selected={runView === "workbench"}');
    expect(homeSource).toContain('aria-selected={runView === "monitor"}');
    expect(homeSource).toContain('setRunView("monitor")');
  });

  it("手机使用全站导航抽屉与顶层路由联动", () => {
    expect(homeSource).toContain('data-aiflow-mobile-nav-trigger=""');
    expect(homeSource).toContain('aria-controls="aiflow-mobile-navigation"');
    expect(homeSource).toContain("<dialog");
    expect(homeSource).toContain("dialog.showModal()");
    expect(homeSource).toContain("onClose={() => setMobileNavOpen(false)}");
    expect(homeSource).toContain('id="aiflow-mobile-navigation"');
    expect(homeSource).toContain('aria-label="工作区导航"');
    expect(homeSource).toContain("setMobileNavOpen(false)");
    expect(homeSource).toContain("nav.map(item =>");
    expect(homeSource).not.toContain("data-aiflow-mobile-workspace-nav");
  });

  it("延迟加载非活动设计器与身份中心查询，避免首屏超大 tRPC 批量", () => {
    expect(homeSource).toContain(
      'const editorActive = section === "flows" && flowView === "editor"'
    );
    expect(homeSource).toContain(
      'const identityActive = section === "system" && systemView === "identity" && user.role === "admin"'
    );
    expect(homeSource).toContain(
      "trpc.workflow.templates.useQuery(undefined, { enabled: editorActive"
    );
    expect(homeSource).toContain(
      "trpc.workflow.subflows.useQuery(undefined, { enabled: editorActive"
    );
    expect(homeSource).not.toContain("workflow.runtimeModels.useQuery");
    expect(homeSource).toContain("enabled: editorActive, retry: false");
    expect(homeSource).toContain("enabled: identityActive, retry: false");
    expect(homeSource).toContain("Boolean(editorActive && selectedId)");
  });

  it("画布与节点检查器在窄屏纵向堆叠，并在大屏恢复双列", () => {
    expect(canvasSource).toContain("grid-cols-1");
    expect(canvasSource).toContain("lg:grid-cols-[minmax(0,1fr)_420px]");
    expect(canvasSource).toContain("lg:grid-cols-[minmax(0,1fr)_620px]");
    expect(canvasSource).toContain(
      "border-t border-border bg-card lg:border-l lg:border-t-0"
    );
  });

  it("画布工具与节点图例分行展示，并以圆角徽标保护图标和长文本", () => {
    expect(canvasSource).toContain("function NodeTypeGlyph");
    expect(canvasSource).toContain('data-flow-node-glyph=""');
    expect(canvasSource).toContain("place-items-center rounded-full border");
    expect(canvasSource).toContain('data-flow-node-palette=""');
    expect(canvasSource).toContain('data-flow-canvas-actions=""');
    expect(canvasSource).toContain("showCanvasActions = true");
    expect(processDetailPageSource).toContain("showCanvasActions={false}");
    expect(canvasSource).toContain("rounded-2xl");
    expect(canvasSource).toContain("max-w-[calc(100vw-3rem)]");
    expect(canvasSource).toContain("break-words text-sm font-semibold");
    expect(canvasSource).toContain("justify-start");
    expect(styleSource).toContain("[data-flow-node-palette]");
    expect(styleSource).toContain("[data-flow-canvas-actions]");
    expect(styleSource).toContain("border-radius: 16px;");
    expect(styleSource).not.toContain(
      ".react-flow__node-workflowNode > div {\n  border-radius: 2px;"
    );
  });

  it("路由规则名称和目标缺失时显示稳定回退文案，不渲染 undefined", () => {
    expect(canvasSource).toContain("`规则 ${index + 1}`");
    expect(canvasSource).toContain('routeTargetId || "待连线"');
    expect(canvasSource).not.toContain("String(route.label ?? route.handle)");
  });

  it("保留版本差异与可审计回滚入口", () => {
    expect(governanceSource).toContain("workflow.versionDiff.useQuery");
    expect(governanceSource).toContain("workflow.rollbackVersion.useMutation");
    expect(governanceSource).toContain("恢复此版本");
    expect(governanceSource).toContain("基本信息");
    expect(governanceSource).toContain('activeSection === "versions"');
    expect(governanceSource).toContain("版本快照");
    expect(governanceSource).toContain("版本差异");
    expect(governanceSource).not.toContain("查看详细配置");
    expect(governanceSource).toContain("实例详情");
    expect(governanceSource).toContain("workflow.runHistoryPage.useQuery");
    expect(governanceSource).toContain(
      "搜索覆盖当前流程全部运行记录 · 每页最多 25 条"
    );
    expect(governanceSource).toContain("更早记录");
    expect(governanceSource).toContain("normalizeWorkflowRunSearchQuery");
    expect(governanceSource).toContain("resetWorkflowAudit.useMutation");
    expect(governanceSource).toContain("重置审核状态");
    expect(governanceSource).toContain("project:manage");
    expect(governanceSource).toContain("最近发布时间");
    expect(governanceSource).toContain("最近取消发布时间");
    expect(governanceSource).toContain("unpublishedAt");
    expect(governanceSource).toContain('data-aiflow-process-detail=""');
    expect(governanceSource).toContain('data-aiflow-process-runs=""');
    expect(governanceSource).toContain('data-aiflow-process-versions=""');
    expect(governanceSource).not.toContain("flow:inspect-node");
  });

  it("窄屏运行记录以统一字号摘要卡呈现全部关键字段", () => {
    const cardsStart = governanceSource.indexOf(
      'data-aiflow-process-run-cards=""'
    );
    const desktopTableStart = governanceSource.indexOf(
      'className="hidden overflow-x-auto md:block"',
      cardsStart
    );
    const mobileCards = governanceSource.slice(cardsStart, desktopTableStart);

    expect(cardsStart).toBeGreaterThanOrEqual(0);
    expect(desktopTableStart).toBeGreaterThan(cardsStart);
    expect(mobileCards).toContain('className="grid gap-2 p-3 md:hidden"');
    expect(mobileCards).toContain("发起人");
    expect(mobileCards).toContain("开始时间");
    expect(mobileCards).toContain("结束时间");
    expect(mobileCards).toContain("presentation.label");
    expect(mobileCards).toContain("aiflow-type-meta");
    expect(mobileCards).toContain("aiflow-type-body");
    expect(mobileCards).toContain("h-11 min-h-11 w-full justify-center");
    expect(mobileCards).toContain("aria-label={`查看运行 ${runId} 实例详情`}");
    expect(governanceSource).toContain(
      'className="w-full min-w-[720px] text-left text-sm"'
    );
  });

  it("恢复原始流程详情的基本信息字段化编辑，并与项目流程编辑权限一致", () => {
    expect(governanceSource).toContain("编辑基本信息");
    expect(governanceSource).toContain("编辑流程基本信息");
    expect(governanceSource).toContain("流程名称");
    expect(governanceSource).toContain("流程说明");
    expect(governanceSource).toContain(
      "trpc.project.updateWorkflowInfo.useMutation"
    );
    expect(governanceSource).toContain(
      'projectAccess.data?.permissions?.has("project:workflow:edit")'
    );
    expect(governanceSource).toContain(
      "不会修改流程定义、审核状态、发布状态或运行记录"
    );
    expect(governanceSource).toContain("<Input value={infoName}");
    expect(governanceSource).toContain("<Textarea value={infoDescription}");
    expect(governanceSource).not.toContain("基本信息 JSON");
    expect(governanceSource).not.toContain("JSON.parse");
    expect(projectWorkspaceSource).not.toContain("WorkflowDetailDialog");
    expect(projectWorkspaceSource).not.toContain(
      "trpc.project.updateWorkflowInfo.useMutation"
    );
    expect(routerSource).toMatch(
      /updateWorkflowInfo:\s*protectedProcedure\s*\.input/
    );
    expect(routerSource).toMatch(
      /description:\s*z\.string\(\)\.trim\(\)\.max\(1200\)\.nullable\(\)\.optional\(\)/
    );
    expect(projectServiceSource).toContain(
      'input.projectId, "project:workflow:edit"'
    );
    expect(projectServiceSource).toContain(
      "WHERE id=? AND projectId=? LIMIT 1"
    );
    expect(projectServiceSource).toContain("project_workflow_info_updated");
  });

  it("将原始流程详情承载为可关闭的受权详情视图，并保留只读画布和设计器返回路径", () => {
    expect(homeSource).toContain(
      '"center" | "workspace" | "detail" | "editor"'
    );
    expect(homeSource).toContain(
      'const detailActive = section === "flows" && flowView === "detail"'
    );
    expect(homeSource).toContain("onOpenDetail={workflowId => navigateRoute(");
    expect(homeSource).toContain('view: "detail", workflowId');
    expect(homeSource).toContain('flowView === "detail" &&');
    expect(homeSource).toContain("<WorkflowDetailPage");
    expect(projectWorkspaceSource).toContain(
      "onOpenDetail: (workflowId: string) => void"
    );
    expect(projectWorkspaceSource).toContain("onDetail={onOpenDetail}");
    expect(processDetailPageSource).toContain(
      'data-aiflow-process-detail-page=""'
    );
    expect(processDetailPageSource).toContain("WorkflowGovernance");
    expect(processDetailPageSource).toContain("canvas={");
    expect(processDetailPageSource).toContain("<WorkflowCanvas");
    expect(processDetailPageSource).toContain("返回流程中心");
    expect(processDetailPageSource).toContain("进入设计器");
    expect(processDetailPageSource).toContain('aria-label="流程详情分区"');
    expect(processDetailPageSource).toContain('label: "流程图与信息"');
    expect(processDetailPageSource).toContain('label: "运行记录"');
    expect(processDetailPageSource).toContain('label: "版本历史"');
    expect(processDetailPageSource).toContain("流程状态摘要");
    expect(processDetailPageSource).toContain(
      "只读预览；流程定义不会在此页面修改。"
    );
    expect(processDetailPageSource).toContain("readOnly");
    const overviewStart = governanceSource.indexOf(
      'activeSection === "overview" && ('
    );
    const overviewCanvasStart = governanceSource.indexOf(
      "{canvas ??",
      overviewStart
    );
    const overviewInfoStart = governanceSource.indexOf(
      "基本信息",
      overviewCanvasStart
    );
    expect(overviewStart).toBeGreaterThanOrEqual(0);
    expect(overviewCanvasStart).toBeGreaterThan(overviewStart);
    expect(overviewInfoStart).toBeGreaterThan(overviewCanvasStart);
  });

  it("长流程名称优先在标识符分隔符处换行并保留完整名称", () => {
    expect(processDetailPageSource).toContain(
      "function workflowNameWithBreakpoints(name: string)"
    );
    expect(processDetailPageSource).toContain("name.split(/([_-])/g)");
    expect(processDetailPageSource).toContain("<wbr />");
    expect(processDetailPageSource).toContain("title={workflow.name}");
    expect(processDetailPageSource).toContain(
      "workflowNameWithBreakpoints(workflow.name)"
    );
  });

  it("保留运行筛选、耗时统计、失败告警和个人复用资产入口", () => {
    expect(runCenterSource).toContain("workflow.runMetrics.useQuery");
    expect(runCenterSource).toContain("workflow.runHistoryPage.useQuery");
    expect(runCenterSource).toContain("更早记录");
    expect(runCenterSource).toContain("较新记录");
    expect(runCenterSource).toContain("按运行状态筛选");
    expect(runCenterSource).toContain(
      "refetchInterval: autoRefreshEnabled ? 15_000 : false"
    );
    expect(runCenterSource).toContain("refetchIntervalInBackground: false");
    expect(runCenterSource).toContain("暂停自动刷新");
    expect(runCenterSource).toContain("立即刷新");
    expect(runCenterSource).toContain("姓名或用户名");
    expect(runCenterSource).toContain("h-11 min-w-0 flex-1");
    expect(runCenterSource).toContain('data-run-filter-panel=""');
    expect(runCenterSource).toContain(
      'className="aiflow-type-control h-11 justify-self-end px-3 lg:col-span-1 lg:h-9"'
    );
    expect(workflowEngineSource).toContain("triggeredByQuery?: string");
    expect(workflowEngineSource).toContain("LOCATE(?,COALESCE(u.name,''))>0");
    expect(workflowEngineSource).toContain(
      "ORDER BY r.createdAt DESC,r.id DESC LIMIT ?"
    );
    expect(routerSource).toContain(
      "triggeredByQuery: z.string().trim().min(1).max(80).optional()"
    );
    expect(governanceSource).toContain("未知状态（原值：${status}）");
    expect(instanceDetailSource).toContain("未知状态（原值：${value}）");
    expect(instanceDetailSource).toContain('waiting: "等待中"');
    expect(instanceDetailSource).toContain('blocked: "已阻塞"');
    expect(runCenterSource).toContain("失败告警");
    expect(runCenterSource).toContain("trpc.workflow.alerts.useQuery(filter");
    expect(runCenterSource).toContain(
      "function formatRunStatus(status: unknown)"
    );
    expect(runCenterSource).toContain('未知状态（原值：${value || "空"}）');
    expect(runCenterSource).toContain(
      'className="aiflow-type-control h-11 lg:h-9"'
    );
    expect(runCenterSource).toContain(
      'className="aiflow-type-control h-11 text-aiflow-info lg:h-9"'
    );
    expect(runCenterSource).toContain(
      'className="aiflow-type-control h-11 text-aiflow-warning lg:h-9"'
    );
    expect(runCenterSource).toContain(
      'className="aiflow-type-control h-11 text-red-700 lg:h-9"'
    );
    expect(runCenterSource).not.toContain("sm:h-7");
    expect(runCenterSource).not.toContain("sm:h-8");
    expect(runCenterSource).toContain("查看运行");
    expect(runCenterSource).toContain("min-w-0 space-y-5 p-4 lg:p-6");
    expect(runCenterSource).toContain(
      "flex w-full min-w-0 flex-col gap-2 lg:w-auto lg:flex-row"
    );
    expect(runCenterSource).toContain("lg:flex-none");
    expect(runCenterSource).toContain(
      "xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]"
    );
    expect(runCenterSource).not.toContain("max-h-[650px] overflow-y-auto");
    expect(runPayloadDetailsSource).toContain(
      "whitespace-pre-wrap break-words"
    );
    expect(homeSource).toContain("compileCheck={compileCheck}");
    expect(homeSource).toContain("流程预检通过");
    expect(homeSource).toContain("预检请求失败：${error.message}");
    expect(homeSource).toContain('compileCheck.status !== "idle"');
    expect(canvasSource).toContain("复用资源");
    expect(canvasSource).toContain("搜索可复用资源");
    expect(canvasSource).toContain("visibleSubflows.map");
    expect(canvasSource).toContain(
      "aria-label={`添加节点模板：${template.name}`}"
    );
    expect(canvasSource).toContain(
      "aria-label={`添加子流程：${subflow.name}`}"
    );
    expect(canvasSource).toContain("保存为节点模板");
    expect(canvasSource).toContain("在画布中编辑");
    expect(canvasSource).not.toContain("模板 JSON 配置");
    expect(canvasSource).not.toContain("高级 JSON 配置");
    expect(canvasSource).not.toContain("应用 JSON 配置");
    expect(homeSource).toContain("保存当前定义为子流程");
  });

  it("运行失败指标仅在实际有失败时使用告警色，并突出关键数字", () => {
    expect(runCenterSource).toContain(
      'const failedMetricTone: "slate" | "red" | "emerald" = metricsUnavailable'
    );
    expect(runCenterSource).toContain('metrics.data.failedRuns > 0 ? "red"');
    expect(runCenterSource).toContain(
      'metrics.data.totalRuns > 0 ? "emerald" : "slate"'
    );
    expect(runCenterSource).toContain("tone={failedMetricTone}");
    expect(runCenterSource).toContain(
      "aiflow-type-display min-w-0 break-words font-bold tabular-nums mt-1 sm:mt-2"
    );
    expect(runCenterSource).not.toContain("sm:text-2xl");
    expect(runCenterSource).toContain("aria-pressed={autoRefreshEnabled}");
  });

  it("运行监控把关键指标与状态说明设为正文档，元信息仅保留次级字号", () => {
    expect(runCenterSource).toContain(
      "aiflow-type-body flex items-center justify-between gap-1 font-medium"
    );
    expect(runCenterSource).toContain(
      "aiflow-type-body rounded-lg border border-border bg-card px-3 py-2 text-muted-foreground"
    );
    expect(runCenterSource).toContain(
      "aiflow-type-body flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-2.5 text-muted-foreground"
    );
    expect(runCenterSource).toContain(
      "aiflow-type-meta font-mono text-muted-foreground"
    );
    expect(runCenterSource).not.toContain("text-[11px] font-medium sm:text-xs");
  });

  it("运行监控在窄屏完整显示当前流程身份并保留字号层级", () => {
    expect(runCenterSource).toContain(
      'className="aiflow-type-body mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-muted-foreground"'
    );
    expect(runCenterSource).toContain(
      'className="min-w-0 max-w-full break-words font-medium text-foreground"'
    );
    expect(runCenterSource).toContain(
      'className="aiflow-type-meta shrink-0 font-mono text-muted-foreground"'
    );
    expect(runCenterSource).not.toContain(
      "break-all font-medium text-foreground"
    );
    expect(runCenterSource).not.toContain(
      'className="mt-1 truncate text-xs text-muted-foreground"'
    );
  });

  it("每次真实运行前必须明确确认外部副作用，且重试重新确认", () => {
    expect(runModalSource).toContain("canStartActualWorkflowRun");
    expect(runModalSource).toContain("acknowledgedActualRun");
    expect(runModalSource).toContain("setAcknowledgedActualRun(false)");
    expect(runModalSource).toContain("disabled={!canStartActualRun}");
    expect(runModalSource).toContain("function ActualRunAcknowledgement");
    expect(runModalSource).toContain("min-h-11 w-full justify-center");
    expect(runModalSource).toContain("我已了解并确认：本次会直接真实执行");
    expect(runModalSource).toContain("当前没有沙箱隔离");
    expect(runModalSource).toContain("handleDialogOpenChange(false)");
  });

  it("实际运行配置弹窗用正文级字号、可访问输入名称和窄屏稳定页脚", () => {
    expect(runModalSource).toContain(
      'className="aiflow-type-body mt-1 text-muted-foreground"'
    );
    expect(runModalSource).toContain(
      'className="aiflow-type-body mt-5 flex items-start gap-2 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface p-3 leading-5 text-amber-900"'
    );
    expect(runModalSource).toContain(
      "aria-label={`输入字段 ${index + 1} 名称`}"
    );
    expect(runModalSource).toContain(
      "aria-label={`输入字段 ${index + 1} 的值`}"
    );
    expect(runModalSource).toContain(
      'className="aiflow-type-meta flex min-w-0 flex-1 flex-col gap-0.5 text-muted-foreground"'
    );
    expect(runModalSource).toContain(
      'className="aiflow-type-control h-11 min-h-11 shrink-0 px-4'
    );
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
    expect(canvasSource).toContain("请选择已启用的私有子流程");
    expect(canvasSource).toContain("zlcxz: selectedSubflow ?");
    expect(canvasSource).toContain("原版扩展字段");
    expect(canvasSource).toContain(
      "Object.entries(record).filter(([key]) => !knownKeys.has(key))"
    );
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
    expect(canvasSource).toContain("!readOnly && (");
    expect(canvasSource).toContain("删除连线");
  });

  it("恢复原版画布左右键、框选、拖放和路径菜单交互", () => {
    expect(canvasSource).toContain("FLOW_NODE_ALLOWED_TARGETS");
    expect(canvasSource).toContain("canConnectFlowNodeTypes");
    expect(nodeContractSource).toContain("FLOW_NODE_ALLOWED_TARGETS");
    expect(canvasSource).toContain("canConnectCanvasNodes");
    expect(canvasSource).toContain("onNodeSelectionClick");
    expect(canvasSource).toContain(
      "event.shiftKey || event.ctrlKey || event.metaKey"
    );
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
    expect(canvasSource).toContain("流程身份（逗号分隔）");
    expect(canvasSource).toContain("请从此路径句柄连线到目标状态节点");
    expect(canvasSource).toContain("默认路径");
    expect(canvasSource).toContain('label: "流转方式"');
    expect(canvasSource).toContain('label: "入口映射"');
    expect(canvasSource).toContain('label: "出口映射"');
    expect(canvasSource).toContain('label: "当前运行映射"');
  });

  it("新增治理、运行分析与复用资产面板在窄屏保持可访问结构", () => {
    expect(governanceSource).toContain("flex flex-col gap-3");
    expect(governanceSource).toContain(
      "xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]"
    );
    expect(runCenterSource).toContain(
      "grid min-w-0 grid-cols-2 items-center gap-2"
    );
    expect(runCenterSource).toContain(
      "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3"
    );
    expect(runCenterSource).toContain("更多指标");
    expect(canvasSource).toContain("搜索节点");
    expect(canvasSource).toContain("搜索可复用资源");
    expect(canvasSource).toContain("更多画布操作");
  });

  it("工作台移动端使用单行视图选择器，关键看板指标可进入对应列表", () => {
    expect(processWorkbenchSource).toContain('data-workbench-view-select=""');
    expect(processWorkbenchSource).toContain(
      "onChange={event => changeView(event.target.value as View)}"
    );
    expect(processWorkbenchSource).toContain(
      'className="hidden min-w-0 lg:mt-2 lg:grid lg:grid-cols-1 lg:gap-2"'
    );
    expect(processWorkbenchSource).toContain(
      'sidebarCollapsed ? "lg:hidden" : ""'
    );
    expect(processWorkbenchSource).toContain("onView={changeView}");
    expect(processWorkbenchSource).toContain(
      "onClick={() => onView(item.view)}"
    );
    expect(processWorkbenchSource).toContain("grid grid-cols-3 gap-2 sm:gap-3");
    expect(processWorkbenchSource).toContain("查看${item.label}流程");
  });

  it("运行列表使用服务端筛选与授权游标分页", () => {
    expect(processWorkbenchSource).toContain(
      'data-aiflow-workbench-list-filters=""'
    );
    expect(processWorkbenchSource).toContain(
      'aria-label="搜索流程、任务节点或发起人"'
    );
    expect(processWorkbenchSource).toContain(
      '? "任务状态" : "流程状态 / 业务阶段"'
    );
    expect(processWorkbenchSource).toContain(
      "aria-label={`按${statusLabel}筛选`}"
    );
    expect(processWorkbenchSource).toContain("<span>{statusLabel}</span>");
    expect(processWorkbenchSource).toContain('aria-label="创建时间开始"');
    expect(processWorkbenchSource).toContain('aria-label="创建时间结束"');
    expect(processWorkbenchSource).toContain(
      "更多筛选，已设置 ${advancedFilterCount} 项"
    );
    expect(processWorkbenchSource).toContain(
      'className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"'
    );
    expect(processWorkbenchSource).toMatch(
      /<details className="min-w-0">[\s\S]*aria-label={[\s\S]*statusLabel[\s\S]*}[\s\S]*aria-label="创建时间开始"[\s\S]*<\/details>/
    );
    const workbenchFilterSource = processWorkbenchSource.slice(
      processWorkbenchSource.indexOf("function WorkbenchListFilters("),
      processWorkbenchSource.indexOf("function TaskList(")
    );
    expect(workbenchFilterSource).not.toContain("text-xs font-medium");
    expect(workbenchFilterSource).toContain(
      'className="aiflow-type-body text-muted-foreground"'
    );
    expect(workbenchFilterSource).toContain(
      'role="alert" className="aiflow-type-body mt-1 text-aiflow-danger"'
    );
    expect(processWorkbenchSource).toContain(
      "trpc.task.page.useQuery(taskInput"
    );
    expect(processWorkbenchSource).toContain(
      "trpc.task.instancePage.useQuery(instanceInput"
    );
    expect(processWorkbenchSource).toContain("上一页");
    expect(processWorkbenchSource).toContain("下一页");
    expect(processWorkbenchSource).toContain("当前页没有符合筛选条件的记录");
    expect(p1ServiceSource).toContain("collectAuthorizedPage");
    expect(p1ServiceSource).toContain("hasTaskActorAccess(row)");
    expect(p1ServiceSource).toContain("DATE_FORMAT(t.createdAt");
    expect(p1ServiceSource).toContain("ORDER BY r.createdAt DESC,r.id DESC");
    expect(routerSource).toContain("pageProcessInstances(ctx.user, input)");
    expect(routerSource).toContain("pageWorkflowTasks(ctx.user, input)");
  });

  it("运行实例详情显示发起人姓名并使用统一的页面与标签字号", () => {
    expect(workflowEngineSource).toContain(
      "SELECT r.*,w.name AS workflowName,initiator.name AS triggeredByName FROM workflow_run r LEFT JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId WHERE r.id=? LIMIT 1"
    );
    expect(instanceDetailSource).toContain("run.triggeredByName ||");
    expect(processWorkbenchRunTabSource).toContain('data-aiflow-page-title=""');
    expect(processWorkbenchRunTabSource).toContain(
      'className="aiflow-type-page-title mt-1 font-semibold text-foreground"'
    );
    expect(processWorkbenchRunTabSource).toContain(
      'className="aiflow-type-control ml-1 flex min-w-0 items-center justify-center gap-1 rounded-t border border-b-0 border-aiflow-info-border bg-card px-2 py-2 font-medium text-aiflow-info sm:gap-2 sm:px-3"'
    );
  });

  it("工作台统计首次加载时不把未知计数显示为零", () => {
    expect(processWorkbenchSource).toContain('{item.count ?? "—"}');
    expect(processWorkbenchSource).toContain("数量正在读取");
    expect(processWorkbenchSource).not.toContain("item.count ?? 0");
    expect(p1ServiceSource).toContain("todo: dashboardPageCount(todo)");
    expect(p1ServiceSource).toContain(
      'return page.items.length ? `≥${page.items.length}` : "待确认"'
    );
    expect(processWorkbenchSource).toContain("“≥”表示已确认数量的下界");
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-body mt-2 text-muted-foreground"'
    );
  });

  it("工作台任务说明使用16px正文，短审批进度使用13px辅助层级", () => {
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-body mt-1 break-words text-muted-foreground"'
    );
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-meta mt-1 inline-flex rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600"'
    );
  });

  it("统一核心子页面上下文标题栏并优化运行筛选窄屏布局", () => {
    expect(projectWorkspaceSource).toContain("data-aiflow-context-header");
    expect(processDetailPageSource).toContain("data-aiflow-context-header");
    expect(homeSource).toContain("data-aiflow-context-header");
    expect(runCenterSource).toContain("data-aiflow-context-header");
    expect(homeSource).toContain("workflowName={selectedWorkflow?.name}");
    expect(runCenterSource).toContain("当前流程：");
    expect(runCenterSource).toContain(
      'aria-label={workflowName || "未命名流程"}'
    );
    expect(runCenterSource).toContain(
      'className="min-w-0 max-w-full break-words font-medium text-foreground"'
    );
    expect(runCenterSource).toContain('data-run-filter-panel=""');
    expect(runCenterSource).toContain(
      'window.matchMedia("(min-width: 1024px)")'
    );
    expect(runCenterSource).toContain("open={advancedFiltersOpen}");
    expect(runCenterSource).toContain(
      'className="col-span-1 min-w-0 lg:contents"'
    );
    expect(runCenterSource).toContain(
      'className="aiflow-type-control flex h-11 min-w-0 cursor-pointer list-none items-center justify-center gap-2 rounded border border-border px-2 text-center text-foreground lg:hidden"'
    );
    expect(runCenterSource).toContain("disabled={!hasRunFilters}");
    expect(runCenterSource).toContain('className="sr-only"');
    expect(homeSource).toContain("grid min-h-12 min-w-0 grid-cols-2");
  });

  it("保留主要工作区、项目工作区和独立系统配置入口", () => {
    expect(homeSource).toContain('label: "已启动流程"');
    expect(homeSource).toContain('label: "流程仓库"');
    expect(homeSource).toContain('label: "系统配置"');
    expect(systemConfigSource).toContain("工作域配置");
    expect(systemConfigSource).toContain("收起配置导航");
    expect(systemConfigSource).toContain("展开配置导航");
    expect(systemConfigSource).toContain('aria-label="系统配置路径"');
    expect(systemConfigSource).toContain(
      'aria-labelledby="system-config-active-tab"'
    );
    expect(systemConfigSource).toContain('data-aiflow-system-config=""');
    expect(styleSource).toContain("[data-aiflow-system-config] > div");
    expect(styleSource).toContain(
      "grid-template-columns: 216px minmax(0, 1fr)"
    );
    expect(projectWorkspaceSource).toContain("状态流程");
    expect(projectWorkspaceSource).toContain("控制流程");
    expect(projectWorkspaceSource).toContain("数据流程");
    expect(projectWorkspaceSource).toContain("收起项目工作区导航");
    expect(projectWorkspaceSource).toContain("展开项目工作区导航");
    expect(projectWorkspaceSource).not.toContain("当前业务：");
    expect(projectWorkspaceSource).toContain("PanelLeftClose");
    expect(projectWorkspaceSource).toContain("PanelLeftOpen");
    expect(projectWorkspaceSource).toContain(
      'className="grid min-w-0 grid-cols-2 gap-1.5 border-b border-border p-1.5 sm:flex sm:flex-wrap'
    );
    expect(projectWorkspaceSource).toContain('aria-label="项目工作区"');
    expect(projectWorkspaceSource).toContain(
      'aria-current={view === item.id ? "page" : undefined}'
    );
    expect(projectWorkspaceSource).toContain(
      "max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-0"
    );
    expect(projectWorkspaceSource).toContain(
      "min-h-0 overflow-y-auto px-4 py-3"
    );
    expect(projectWorkspaceSource).toContain(
      "flex shrink-0 flex-wrap gap-2 border-t border-border bg-popover p-3"
    );
    expect(projectWorkspaceSource).toContain(
      'data-aiflow-project-workspace=""'
    );
    expect(styleSource).toContain("[data-aiflow-project-workspace] > aside");
    expect(styleSource).toContain("width: 216px !important");
    expect(projectWorkspaceSource).toContain("创建时间开始");
    expect(projectWorkspaceSource).toContain("创建时间结束");
    expect(projectWorkspaceSource).toContain("同步 BDP 配置");
    expect(projectWorkspaceSource).toContain("导入业务");
    expect(projectWorkspaceSource).toContain('accept=".csv,text/csv"');
    expect(projectWorkspaceSource).toContain("CSV 标题必须包含");
    expect(projectWorkspaceSource).toContain("业务代号、业务名称");
    expect(projectWorkspaceSource).toContain(
      "仅展示当前账号有权查看的业务项目；筛选不会扩大访问范围。"
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body mt-2 text-muted-foreground"> 仅展示当前账号有权查看的业务项目；筛选不会扩大访问范围。'
    );
    expect(projectWorkspaceSource).toContain(
      'details className="group mt-3 border-t border-border pt-2"'
    );
    expect(projectWorkspaceSource).toContain("group-open:rotate-180");
    expect(projectWorkspaceSource).toContain(
      '<ChevronDown size={16} aria-hidden="true"'
    );
    expect(projectWorkspaceSource).toContain(
      'view === "process" && workflows.isLoading'
    );
    expect(projectWorkspaceSource).toContain("正在读取项目流程");
    expect(projectWorkspaceSource).toContain(
      "正在加载当前业务授权范围内的流程与审核状态"
    );
    expect(projectWorkspaceSource).toContain("重置筛选");
    expect(projectWorkspaceSource).toContain("可重置筛选或从右上角新建流程。");
    expect(projectWorkspaceSource).toContain("workflows.isError");
    expect(projectWorkspaceSource).toContain("流程列表读取失败");
    expect(projectWorkspaceSource).toContain("最近取消发布时间");
    expect(projectWorkspaceSource).toContain("尚未取消发布");
    expect(projectWorkspaceSource).toContain(
      "workflow.publishedAt ? formatDate(workflow.publishedAt)"
    );
    expect(projectWorkspaceSource).toContain(
      "workflow.unpublishedAt ? formatDate(workflow.unpublishedAt)"
    );
    expect(projectWorkspaceSource).toContain("colSpan={6}");
    expect(projectWorkspaceSource).toContain(
      'workflow.status === "published" ? workflow.flowType === "data" ? "执行" : "发起" : "设计"'
    );
    expect(projectWorkspaceSource).toContain(
      "trpc.workflow.publish.useMutation"
    );
    expect(projectWorkspaceSource).toContain(
      "trpc.workflow.unpublish.useMutation"
    );
    expect(projectWorkspaceSource).toContain(
      'workflow.status === "draft" && workflow.auditStatus === "approved"'
    );
    expect(projectWorkspaceSource).toContain(
      'workflow.status === "published" && ( <button'
    );
    expect(projectWorkspaceSource).toContain(
      "unpublish.mutate({ id: workflow.id })"
    );
    expect(projectWorkspaceSource).toContain("取消发布");
    expect(systemConfigSource).toContain("APPROVAL CONFIGURATION");
    expect(systemConfigSource).toContain("WORK DOMAIN");
  });

  it("保留树形仓库、只读画布预览、批量 JSON 导出和原始流程节点分类", () => {
    expect(warehouseSource).toContain("PROCESS WAREHOUSE");
    expect(warehouseSource).toContain(
      "勾选后可批量导出；点击流程可查看简介和只读画布。"
    );
    expect(warehouseSource).not.toContain("在右侧查看简介");
    expect(warehouseSource).toContain(
      "xl:grid-cols-[240px_minmax(280px,1fr)_minmax(500px,1.35fr)]"
    );
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
    expect(warehouseSource).toContain(
      "aiflow-type-section-title font-semibold text-foreground"
    );
    expect(warehouseSource).toContain(
      "aiflow-type-card-title min-w-0 flex-1 break-words font-semibold leading-6"
    );
    expect(warehouseSource).toContain(
      "aiflow-type-card-title min-w-0 break-words font-semibold leading-6 text-foreground"
    );
    expect(warehouseSource).toContain(
      'const displayWorkflowName = (name: string) => name.replaceAll("_", "_\\u200b");'
    );
    expect(warehouseSource).toContain("aria-label={workflow.name}");
    expect(warehouseSource).toContain("aria-label={workflowDetail.data.name}");
    expect(warehouseSource).toContain(
      'className="aiflow-type-control h-11 min-h-11 max-w-40 rounded border border-border bg-card px-2'
    );
    expect(styleSource).toContain(
      "[data-aiflow-warehouse] > div > div:first-child"
    );
    expect(styleSource).not.toContain(
      "[data-aiflow-warehouse] > div > div:first-child > div"
    );
    expect(styleSource).not.toContain(
      "grid-template-columns: 250px minmax(0, 1fr) 380px;"
    );
    expect(styleSource).toContain(
      "[data-aiflow-warehouse] > div > div:first-child button"
    );
    expect(warehouseSource).toContain("请输入搜索内容");
    expect(warehouseSource).toContain("批量操作");
    expect(warehouseSource).toContain("批量导入");
    expect(warehouseSource).toContain("流程简介");
    expect(warehouseSource).toContain("没有搜到任何数据");
    expect(warehouseSource).toContain("只读流程图");
    expect(warehouseSource).toContain("hasFolderMatch");
    expect(warehouseSource).toContain(
      "rawChildren(folder.id).some(hasFolderMatch)"
    );
    expect(warehouseSource).toContain("新增同级文件夹");
    expect(warehouseSource).toContain("新增子级文件夹");
    expect(warehouseSource).toContain("添加同级");
    expect(warehouseSource).toContain("添加子级");
    expect(warehouseSource).toContain("确认删除");
    expect(warehouseSource).toContain("trpc.workflow.delete.useMutation");
    expect(warehouseSource).toContain("归档流程");
    expect(warehouseSource).toContain(
      "版本、运行、任务、成员授权和审计记录均会保留"
    );
    expect(warehouseSource).toContain("trpc.workflow.restore.useMutation");
    expect(warehouseSource).toContain("可恢复归档流程");
    expect(warehouseSource).toContain(
      'className="mt-1 text-sm text-muted-foreground"'
    );
    expect(warehouseSource).toContain(
      'className="p-10 text-center text-sm text-muted-foreground"'
    );
    expect(warehouseSource).toContain("canManageSelected");
    expect(routerSource).toContain("archived: protectedProcedure");
    expect(routerSource).toContain("restore: protectedProcedure");
    expect(workflowServiceSource).toContain("status IN ('queued','running')");
    expect(workflowServiceSource).toContain("数据流程仍有启用中的调度");
    expect(workflowServiceSource).toContain("canRestore");
    expect(workflowEngineSource).toContain("已归档流程不能发起运行");
    expect(workflowEngineSource).toContain(
      "SELECT archivedAt,flowType,status,definitionVersion FROM workflow WHERE id=? LIMIT 1 FOR UPDATE"
    );
    expect(projectServiceSource).toContain("archivedAt IS NULL");
    expect(dataflowServiceSource).toContain(
      "archivedAt IS NULL LIMIT 1 FOR UPDATE"
    );
    expect(canvasSource).toContain("取消高亮");
    expect(canvasSource).toContain("保存为图片");
    expect(canvasSource).toContain("全屏");
    expect(warehouseSource).toContain(
      'selectedWorkflowId ? "hidden xl:block" : ""'
    );
    expect(warehouseSource).toContain('aria-label="返回流程列表"');
    expect(warehouseSource).toContain("compactReadOnlyPreview");
    expect(canvasSource).toContain(
      'compactReadOnlyPreview ? "min-h-0" : "min-h-[650px]"'
    );
    expect(canvasSource).toContain(
      'compactReadOnlyPreview ? "h-[340px] sm:h-[420px] lg:h-[520px]"'
    );
    expect(canvasSource).toContain(
      "padding: compactReadOnlyPreview ? 0.12 : 0.22, minZoom: 0.1, maxZoom: 1.25"
    );
    expect(canvasSource).toContain(
      'compactReadOnlyPreview ? "hidden" : "hidden md:block"'
    );
    expect(canvasSource).toContain('"hidden md:block"');
    expect(canvasSource).toContain('className="flow-canvas-controls"');
    expect(styleSource).toContain(
      "[data-aiflow-workflow-canvas] .flow-canvas-controls"
    );
    expect(styleSource).toContain("flex-direction: row;");
    expect(styleSource).toContain("min-height: 44px;");
    expect(styleSource).toContain("min-width: 44px;");
  });

  it("仓库预览明确区分读取中、读取失败和详情缺失", () => {
    expect(warehouseSource).toContain("workflowDetail.isLoading ?");
    expect(warehouseSource).toContain('role="status"');
    expect(warehouseSource).toContain("正在读取所选流程简介和只读画布");
    expect(warehouseSource).toContain("workflowDetail.isError ?");
    expect(warehouseSource).toContain('role="alert"');
    expect(warehouseSource).toContain("暂时无法读取所选流程详情，请重试。");
    expect(warehouseSource).toContain("workflowDetail.refetch()");
    expect(warehouseSource).not.toContain("全屏与图片工具位于预览画布");
    expect(warehouseSource).toContain(
      "未能取得所选流程的详情，请返回列表重新选择。"
    );
    expect(warehouseSource).not.toContain("从中间列表选择一条流程");
  });

  it("让三类流程目录和服务端运行边界共用 FlowProfile 合同", () => {
    expect(flowProfileSource).toContain("STATE_NODE_TYPES");
    expect(flowProfileSource).toContain("CONTROL_NODE_TYPES");
    expect(flowProfileSource).toContain("DATA_NODE_TYPES");
    expect(canvasSource).toContain("isFlowNodeAllowed(flowType, item.type)");
    expect(workflowEngineSource).toContain(
      "数据流程必须通过数据流运行入口启动"
    );
    expect(canvasSource).toContain("readOperateOutcomes");
    expect(canvasSource).toContain("拒绝即取消实例");
    expect(workflowEngineSource).toContain("resolveOperateOutcomeRouting");
    expect(workflowEngineSource).toContain("workflow_state_transition");
    expect(processWorkbenchSource).toContain("taskOutcomeOptions");
    expect(processWorkbenchSource).toContain("仅展示当前操作合同允许的结果");
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
    expect(canvasSource).toContain(
      '["restHeaderParam", "restGetBodyParam"].includes(fieldKey)'
    );
    expect(canvasSource).toContain("GET 参数");
    expect(canvasSource).toContain("添加字段");
    expect(canvasSource).toContain("添加一项");
    expect(canvasSource).not.toContain("function JsonField");
    expect(canvasSource).toContain("LockKeyhole");
    expect(canvasSource).toContain("最大化面板");
    expect(canvasSource).toContain("恢复配置面板");
    expect(canvasSource).toContain("最小化面板");
    expect(canvasSource).toContain('role="tablist"');
    expect(canvasSource).toContain('role="tabpanel"');
    expect(canvasSource).toContain("rounded-2xl border bg-card");
    expect(canvasSource).toContain("画布说明");
    expect(canvasSource).toContain("RotateCcw");
    expect(canvasSource).toContain("若无元件，请添加元件。");
    expect(canvasSource).not.toContain("当前裁剪安装包未保留节点打包脚本");
    expect(canvasSource).toContain(
      "next.nodes.some(node => node.id === current)"
    );
    expect(homeSource).toContain("返回项目流程中心");
    expect(homeSource).toContain("返回流程详情");
    expect(homeSource).toContain("返回流程仓库");
    expect(homeSource).toContain("onBackToDesignCenter");
    expect(homeSource).toContain("保存画布");
  });

  it("保留原始流程详情的流程图标题段、画布工具和安全画布联动", () => {
    expect(processDetailPageSource).toContain(
      "只读预览；流程定义不会在此页面修改。"
    );
    expect(processDetailPageSource).toContain("flow:save-canvas-image");
    expect(processDetailPageSource).toContain("flow:fullscreen-canvas");
    expect(processDetailPageSource).not.toContain("flow:neaten-canvas");
    expect(processDetailPageSource).not.toContain("查看详细配置");
    expect(canvasSource).toContain(
      'window.addEventListener("flow:save-canvas-image"'
    );
    expect(canvasSource).toContain(
      'window.addEventListener("flow:fullscreen-canvas"'
    );
  });

  it("数据流工作台聚合概览、运行和调度，并按发布状态显示草稿表单", () => {
    expect(dataResourceSource).toContain("dataflow-workspace");
    expect(dataResourceSource).toContain("实验功能");
    expect(dataResourceSource).toContain(
      'className="flex flex-col gap-1 rounded-md border border-aiflow-warning-border bg-aiflow-warning-surface px-3 py-2 text-sm leading-5 text-amber-900 sm:flex-row sm:items-center sm:justify-between"'
    );
    expect(dataResourceSource).toContain(
      'className="mt-1 text-sm leading-5 text-muted-foreground"'
    );
    expect(dataResourceSource).toContain(
      "执行会创建真实运行，可能读取或写入外部数据。"
    );
    expect(dataResourceSource).toContain("trpc.project.list.useQuery()");
    expect(dataResourceSource).toContain("数据资源");
    expect(dataResourceSource).toContain("函数资源");
    expect(dataResourceSource).toContain('"overview" | "runs" | "schedules"');
    expect(dataResourceSource).toContain('aria-label="数据流工作区视图"');
    expect(dataResourceSource).toContain(
      'aria-current={section === item.id ? "page" : undefined}'
    );
    expect(dataResourceSource).toContain("资源引用");
    expect(dataResourceSource).toContain("assets.slice(0, 5)");
    expect(dataResourceSource).toContain('onOpenResourceTab("assets")');
    expect(dataResourceSource).toContain('onOpenResourceTab("udfs")');
    expect(dataResourceSource).toContain("运行记录与审计");
    expect(dataResourceSource).toContain("当前接口最多返回最近 30 条");
    expect(dataResourceSource).toContain("新增调度草稿");
    expect(dataResourceSource).toContain("publishedFlows.length > 0 ?");
    expect(dataResourceSource).toContain("dataflow-schedule-empty");
    expect(dataResourceSource).toContain("当前没有已发布数据流");
    expect(dataResourceSource).toContain("{item.cronExpression} UTC");
    expect(dataResourceSource).toContain("StructuredResourceForm");
    expect(dataResourceSource).toContain(
      'title === "添加数据源" || title === "资源探查结果"'
    );
    expect(dataResourceSource).toContain("return null;");
    const resourceFormSource = dataResourceSource.slice(
      dataResourceSource.indexOf("function ResourceForm")
    );
    expect(resourceFormSource).not.toContain("JSON.parse");
    expect(dataResourceSource).not.toContain("sourceForm.");
    expect(dataResourceSource).not.toContain("assetForm.");
    expect(dataResourceSource).toContain("data-resource-center");
    expect(dataResourceSource).toContain("dataflow-run-list");
    expect(dataResourceSource).toContain("搜索已加载的运行记录");
    expect(dataResourceSource).toContain("未找到匹配的运行记录。");
    expect(dataResourceSource).toContain("操作 ID");
    expect(dataResourceSource).toContain("结束时间");
    expect(dataResourceSource).toContain("查看审计");
    expect(dataResourceSource).toContain("function DataflowRunOutput");
    expect(dataResourceSource).toContain("最终结果预览");
    expect(dataResourceSource).toContain("节点执行摘要");
    expect(dataResourceSource).toContain("查看完整原始数据（JSON）");
    expect(dataResourceSource).toContain("max-h-72 max-w-full overflow-auto");
    expect(dataResourceSource).not.toContain("max-h-none");
    expect(dataResourceSource).toContain(
      "执行真实数据流；可能读取或写入外部数据"
    );
    expect(dataResourceSource).toContain("打开设计器");
    expect(dataResourceSource).toContain("运行数据流");
    expect(dataResourceSource).toContain(
      "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
    );
    expect(dataResourceSource).not.toContain("打开并保存画布");
    expect(dataResourceSource).not.toContain("画布辅助工具");
    expect(dataResourceSource).not.toContain(
      "function DataFlowCanvasReferenceShell"
    );
  });

  it("没有已发布数据流时隐藏可保存的 UTC Cron 输入", () => {
    expect(dataResourceSource).toContain("publishedFlows.length > 0 ? (");
    expect(dataResourceSource).toContain("dataflow-schedule-empty");
    expect(dataResourceSource).toContain(
      "发布后再创建调度，不显示可保存的 Cron 输入。"
    );
    expect(dataResourceSource).toContain("启用后会按计划真实运行数据流");
  });

  it("系统配置保持字段化表单，不要求管理员编辑 JSON", () => {
    expect(systemConfigSource).toContain("平台名称");
    expect(systemConfigSource).toContain("要求审核通过后发布");
    expect(systemConfigSource).toContain("工作域名称");
    expect(systemConfigSource).not.toContain("JSON.parse");
  });

  it("新建工作域字段始终显示标签并使用统一控件字号与操作尺寸", () => {
    for (const field of ["code", "name", "description"]) {
      expect(systemConfigSource).toContain(`htmlFor="new-domain-${field}"`);
      expect(systemConfigSource).toContain(`id="new-domain-${field}"`);
    }
    expect(systemConfigSource).toContain(
      'className="aiflow-type-control grid gap-1 font-medium text-foreground"'
    );
    expect(systemConfigSource).toContain(
      'className="aiflow-type-control h-11 min-h-11 min-[1024px]:h-10 min-[1024px]:min-h-0"'
    );
    expect(systemConfigSource).not.toContain('<Input placeholder="域代号"');
  });

  it("通用设置不重复展示表单值，宽屏字段对齐到同一网格", () => {
    const generalSettingsSource = systemConfigSource.slice(
      systemConfigSource.indexOf("function GeneralSettings()"),
      systemConfigSource.indexOf("function ApprovalSettings()")
    );
    expect(generalSettingsSource).not.toContain("<ConfigCard");
    expect(generalSettingsSource).toContain(
      'className="mt-6 grid gap-4 rounded-lg border border-border p-5"'
    );
    expect(generalSettingsSource).toContain(
      'className="grid gap-4 sm:grid-cols-2"'
    );
    expect(generalSettingsSource).toContain(
      'className="grid content-start gap-3"'
    );
    expect(generalSettingsSource).toContain(
      'className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2"'
    );
    expect(
      generalSettingsSource.match(/className="h-11 min-\[1024px\]:h-10"/g)
    ).toHaveLength(2);
    expect(generalSettingsSource).toContain(
      "min-h-11 items-center gap-2 text-sm text-foreground min-[1024px]:min-h-10"
    );
    expect(generalSettingsSource).toContain(
      "h-11 w-fit bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10"
    );
    expect(generalSettingsSource).toContain("启用系统水印");
    expect(generalSettingsSource).toContain("水印文字");
    expect(generalSettingsSource).toContain("保存通用设置");
    expect(generalSettingsSource).toContain(
      "const settingsReady = settings.isSuccess && Boolean(persistedGeneral);"
    );
    expect(generalSettingsSource).toContain("settings.refetch()");
    expect(generalSettingsSource).toContain("默认值不会提交");
    expect(generalSettingsSource).toContain("const hasChanges =");
    expect(generalSettingsSource).toContain(
      "disabled={!canEditSettings || update.isPending || !hasChanges}"
    );
    expect(generalSettingsSource).toContain(
      "if (!canEditSettings || update.isPending || !hasChanges) return;"
    );
    expect(generalSettingsSource).toContain("有未保存的通用设置更改");
  });

  it("审批设置分离策略说明与配置控件，并保留触控目标尺寸", () => {
    const approvalSettingsSource = systemConfigSource.slice(
      systemConfigSource.indexOf("function ApprovalSettings()"),
      systemConfigSource.indexOf("function DomainSettings()")
    );
    expect(approvalSettingsSource).toContain(
      'className="mt-6 grid gap-5 rounded-lg border border-border bg-card p-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]"'
    );
    expect(approvalSettingsSource).toContain(
      'className="h-11 rounded-md border border-border bg-card px-3 text-sm min-[1024px]:h-10"'
    );
    expect(approvalSettingsSource).toContain(
      "min-h-11 items-center gap-2 text-sm font-medium text-foreground min-[1024px]:min-h-10"
    );
    expect(approvalSettingsSource).toContain(
      "h-11 bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10"
    );
    expect(approvalSettingsSource).toContain(
      "const settingsReady = settings.isSuccess && Boolean(approvalSettings);"
    );
    expect(approvalSettingsSource).toContain(
      "settings.isLoading && !settings.data"
    );
    expect(approvalSettingsSource).toContain("settings.refetch()");
    expect(approvalSettingsSource).toContain("默认值不会提交");
    expect(approvalSettingsSource).toContain("const hasChanges =");
    expect(approvalSettingsSource).toContain(
      "disabled={!canEditSettings || update.isPending || !hasChanges}"
    );
    expect(approvalSettingsSource).toContain(
      "if (!canEditSettings || update.isPending || !hasChanges) return;"
    );
    expect(approvalSettingsSource).toContain(
      "requireProjectApproval: form.required"
    );
    expect(approvalSettingsSource).toContain("reviewerMode: form.reviewerMode");
    expect(approvalSettingsSource).toContain("当前发布门禁由服务端强制执行");
  });

  it("保留已启动流程的任务移交、退回与逐项批量处理入口", () => {
    expect(processWorkbenchSource).toContain("批量领取");
    expect(processWorkbenchSource).toContain("批量同意");
    expect(processWorkbenchSource).toContain("批量拒绝");
    expect(processWorkbenchSource).toContain("批量弃权");
    expect(processWorkbenchSource).toContain("批量拒绝必须填写处理意见");
    expect(processWorkbenchSource).toContain("任务移交与回退");
    expect(processWorkbenchSource).toContain("移交");
    expect(processWorkbenchSource).toContain("退回待处理");
    expect(processWorkbenchSource).toContain("不会跨流程或跨项目执行");
    expect(processWorkbenchSource).toContain("trpc.task.handover.useMutation");
    expect(processWorkbenchSource).toContain(
      "trpc.task.batchComplete.useMutation"
    );
    expect(processWorkbenchSource).toContain("outcome, setOutcome");
    expect(processWorkbenchSource).toContain(
      '"approved" | "rejected" | "abstained"'
    );
    expect(processWorkbenchSource).toContain("taskOutcomeOptions");
    expect(processWorkbenchSource).toContain("commentRequired");
    expect(processWorkbenchSource).not.toContain("拒绝并终止流程");
    expect(processWorkbenchSource).toContain("处理审批");
    expect(processWorkbenchSource).toContain("无可执行操作");
    expect(processWorkbenchSource).toContain("直接上级审核通过，待经理通过");
    expect(processWorkbenchSource).not.toContain(
      "批量处理结果必须是合法 JSON 对象"
    );
    expect(processWorkbenchSource).toContain("处理结果字段");
    expect(processWorkbenchSource).toContain("添加处理结果字段");
    expect(processWorkbenchSource).not.toContain("function LegacyTaskDrawer");
    expect(processWorkbenchSource).not.toContain("处理结果（JSON）");
    expect(processWorkbenchSource).not.toContain("JSON.parse(resultText)");
    expect(homeSource).not.toContain("运行输入必须是合法 JSON 对象");
    expect(homeSource).not.toContain("JSON.parse(runInput)");
    expect(homeSource).toContain("useState<Record<string, unknown>>");
    expect(homeSource).not.toContain('prompt: "请总结输入内容"');
    expect(homeSource).toContain("Object.fromEntries");
    expect(processWorkbenchSource).toContain(
      "const payload = createPayload(resultRows)"
    );
    expect(processWorkbenchSource).toContain("任务表单 · v");
    expect(canvasSource).toContain(
      "trpc.workflow.previewParticipants.useMutation"
    );
    expect(canvasSource).toContain("预览候选人");
    expect(canvasSource).toContain('["default", "compensation"]');
    expect(processWorkbenchSource).toContain("onComplete(payload)");
    expect(processWorkbenchSource).toContain("收起已启动流程导航");
    expect(processWorkbenchSource).toContain("展开已启动流程导航");
    expect(processWorkbenchSource).toContain(
      "当前视图仅展示具备运行权限的流程实例与人工任务"
    );
    expect(processWorkbenchSource).toContain("PanelLeftClose");
    expect(processWorkbenchSource).toContain("PanelLeftOpen");
    expect(processWorkbenchSource).toContain(
      'aria-labelledby="workflow-task-drawer-title"'
    );
    expect(processWorkbenchSource).toContain('event.key === "Escape"');
    expect(processWorkbenchSource).toContain("data-process-workbench-loading");
    expect(processWorkbenchSource).toContain("正在读取已启动流程");
    expect(processWorkbenchSource).toContain(
      "正在加载当前授权范围内的看板统计与最近任务"
    );
    expect(processWorkbenchSource).toContain(
      '(view !== "board" || item.id === "done")'
    );
    expect(processWorkbenchSource).toContain('label: "全部可见"');
    expect(processWorkbenchSource).toContain('label: "我发起"');
    expect(processWorkbenchSource).toContain("ProcessWorkbenchRunTab");
    expect(processWorkbenchSource).toContain("onOpenRun={setSelectedRunId}");
    expect(processWorkbenchSource).toContain("baseTabLabel={labels[view]}");
    expect(processWorkbenchSource).toMatch(
      /const closeRunTab = \(\) => \{\s*setSelectedRunId\(null\);\s*invalidate\(\);\s*\}/
    );
    expect(processWorkbenchSource).toMatch(
      /setSelectedRunId\(null\);\s*setSelectedTaskId\(null\);\s*setSelectedTaskIds\(\[\]\);\s*setPageCursorStack\(\[undefined\]\);\s*setListSearch\(""\);\s*setDebouncedListSearch\(""\);\s*setListStatus\("all"\);\s*setListFrom\(""\);\s*setListThrough\(""\);\s*invalidate\(\);/
    );
    expect(styleSource).toContain("min-height: 46px;");
    expect(processWorkbenchRunTabSource).toContain("关闭实例详情页签");
    expect(processWorkbenchRunTabSource).toContain("返回工作台");
    expect(processWorkbenchRunTabSource).toContain(
      "trpc.workflow.runDetail.useQuery"
    );
    expect(processWorkbenchRunTabSource).toContain("baseTabLabel");
    expect(processWorkbenchRunTabSource).toContain(
      "title={`返回${baseTabLabel}`}"
    );
    expect(processWorkbenchRunTabSource).toContain(
      "data-process-workbench-tabs"
    );
  });

  it("我发起列表使用统一的正文、元数据和操作字号", () => {
    expect(processWorkbenchSource).toContain('data-workbench-instance-card=""');
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-body min-w-0 flex-1 break-words font-semibold text-foreground"'
    );
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-meta min-w-0 truncate text-right font-mono text-muted-foreground"'
    );
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-body min-w-0 break-words text-right text-muted-foreground"'
    );
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-meta min-w-0 break-words text-right tabular-nums text-muted-foreground"'
    );
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-control mt-3 min-h-11 w-full text-aiflow-info"'
    );
  });

  it("可查看但不归当前用户处理的待办只显示只读说明", () => {
    expect(p1ServiceSource).toContain(
      "canAct: isCurrentTaskOwner(user.id, task)"
    );
    expect(p1ServiceSource).toContain(
      "canAct: isCurrentTaskOwner(user.id, row)"
    );
    expect(processWorkbenchSource.match(/\{canManage && \(/g)).toHaveLength(2);
    expect(processWorkbenchSource).toContain(
      "此任务仅供查看；处理操作由指定处理人完成。"
    );
    expect(processWorkbenchSource).toMatch(
      /const taskInstructionLabel = isHistoricalTask[\s\S]*?"指定处理人办理说明";/
    );
    expect(processWorkbenchSource).toContain(
      '"请由指定处理人完成当前人工操作。"'
    );
    expect(processWorkbenchSource).toContain(
      '<p className="aiflow-type-meta font-bold tracking-[.16em] text-muted-foreground">'
    );
    expect(processWorkbenchSource).toContain("{taskInstructionLabel}");
    expect(processWorkbenchSource).toContain("task.canViewRun === true");
    expect(processWorkbenchSource).toContain("查看运行详情");
    expect(processWorkbenchSource).toContain(
      '["pending", "claimed"].includes(task.status)'
    );
    expect(processWorkbenchSource).toMatch(
      /\["pending", "claimed"\]\.includes\(task\.status\)[\s\S]*task\.canAct !== true/
    );
    expect(processWorkbenchSource).toContain("经办人 {currentHandler}");
    expect(processWorkbenchSource).toContain(
      "当前经办人：{task.claimedByName}"
    );
  });

  it("工作台待办数与可办理任务归属一致，最近任务解释只读范围", () => {
    expect(p1ServiceSource).toContain(
      "t.status IN ('pending','claimed') AND ((t.status='pending'"
    );
    expect(p1ServiceSource).toContain(
      "(t.status='claimed' AND t.claimedByUserId=?))"
    );
    expect(p1ServiceSource).not.toContain(
      "JSON_LENGTH(t.candidateUserIdsJson)=0"
    );
    expect(p1ServiceSource).toContain("claimant.name AS claimedByName");
    expect(processWorkbenchSource).toContain("经办人 {currentHandler}");
    expect(processWorkbenchSource).toContain(
      "包含本人待办、已办和发起的近期任务；待办数只统计当前分配/候选给本人或由本人领取的任务。"
    );
  });

  it("设计器标题使用可用宽度和统一字号，常用按钮保留触控尺寸", () => {
    expect(homeSource).toContain(
      'className="mt-1.5 flex w-full min-w-0 items-center gap-1"'
    );
    expect(homeSource).toContain("<textarea");
    expect(homeSource).toContain("rows={1}");
    expect(homeSource).toContain("max-h-24 w-full min-w-0 resize-none");
    expect(homeSource).toContain("[overflow-wrap:anywhere]");
    expect(homeSource).toContain("Math.min(field.scrollHeight, 96)");
    expect(homeSource).toContain('title={name || "双击或聚焦以编辑流程名称"}');
    expect(styleSource).toContain(":is(h1, [data-aiflow-page-title])");
    expect(homeSource).toContain("h-11 min-h-11 gap-1.5");
    expect(canvasSource).toContain("inline-flex h-11 cursor-pointer");
    expect(canvasSource).toContain("h-11 w-11 gap-0 p-0");
    expect(canvasSource).toContain('aria-label="更多画布操作"');
    expect(canvasSource).toContain('className="hidden sm:inline"');
    expect(canvasSource).toContain(
      "inline-flex min-h-11 cursor-pointer items-center"
    );
    expect(canvasSource).toContain("previousInspectorExpandedRef");
    expect(canvasSource).toContain(
      "reactFlow.fitView({ padding: compactReadOnlyPreview ? 0.12 : 0.22, minZoom: 0.1, maxZoom: 1.25, duration: 180,"
    );
    expect(canvasSource).toContain('aria-label="保存为图片"');
    expect(canvasSource).toContain('aria-label="取消高亮"');
    expect(canvasSource).toContain("<DropdownMenuTrigger asChild>");
    expect(canvasSource).toContain(
      '<DropdownMenuContent align="end" className="min-w-44">'
    );
    expect(canvasSource).toContain("<DropdownMenuItem");
    expect(canvasSource).not.toContain(
      '<details className="relative ml-auto">'
    );
  });

  it("设计器主要操作和属性控件在触屏断点保持 44px、桌面至少 36px", () => {
    expect(homeSource).toContain("min-[1024px]:h-9 min-[1024px]:min-h-0");
    expect(homeSource).not.toContain("sm:h-7 sm:min-h-0");
    expect(homeSource).not.toContain("sm:h-8 sm:min-h-0");
    expect(canvasSource).toContain('data-flow-canvas-actions=""');
    expect(canvasSource).toContain("h-11 w-11 gap-0");
    expect(canvasSource).toContain("min-[1024px]:h-9");
    expect(canvasSource).toContain(
      '"aiflow-type-control h-11 min-h-11 w-full rounded-md border'
    );
    expect(canvasSource).toContain(
      '"aiflow-type-control h-11 min-h-11 min-w-0 rounded border'
    );
    expect(canvasSource).not.toContain(
      '"h-8 min-w-0 rounded border border-border bg-card px-2 text-xs'
    );
  });

  it("平板主导航保持单行可滚动，流程详情采用紧凑预览与触控尺寸", () => {
    expect(homeSource).toContain('data-aiflow-brand-name=""');
    expect(homeSource).toContain('data-aiflow-primary-nav=""');
    expect(homeSource).toContain('data-aiflow-user-actions=""');
    expect(styleSource).toContain(
      "@media (min-width: 768px) and (max-width: 1023px)"
    );
    expect(styleSource).toContain("[data-aiflow-brand] > div:first-child");
    expect(styleSource).toContain("[data-aiflow-user-actions] button");
    expect(styleSource).toContain("[data-aiflow-primary-nav] > button");
    expect(styleSource).toContain("overscroll-behavior-x: contain;");
    expect(styleSource).toContain(
      '[data-aiflow-process-detail-page] [role="tab"]'
    );
    expect(processDetailPageSource).toContain("line-clamp-2");
    expect(processDetailPageSource).toContain("title={workflow.name}");
    expect(processDetailPageSource).toContain("compactReadOnlyPreview");
    expect(canvasSource).toContain("h-[340px] sm:h-[420px] lg:h-[520px]");
  });

  it("原安装包视觉壳层保持浅色平面工作台与三栏画布结构", () => {
    expect(homeSource).toContain('data-aiflow-console=""');
    expect(homeSource).toContain('data-aiflow-designer=""');
    expect(homeSource).toContain("AI FLOW GRAPH");
    expect(homeSource).not.toContain("NEBULA BUSINESS ENGINE");
    expect(styleSource).not.toContain(
      "[data-aiflow-designer] textarea.h-20.font-mono"
    );
    expect(homeSource).toContain("AI FLOW GRAPH");
    expect(homeSource).toContain("bg-background");
    expect(homeSource).not.toContain("NEBULA INSPIRED · V3");
    expect(canvasSource).toContain('data-aiflow-workflow-canvas=""');
    expect(projectWorkspaceSource).toContain('data-aiflow-business-center=""');
    expect(projectWorkspaceSource).toContain(
      'data-project-service-endpoints=""'
    );
    expect(projectWorkspaceSource).toContain(
      "trpc.project.serviceEndpoints.useQuery"
    );
    expect(projectWorkspaceSource).toContain("SecretRef 只引用运行环境密钥");
    expect(warehouseSource).toContain('data-aiflow-warehouse=""');
    expect(styleSource).toContain('content: "AI FLOW GRAPH"');
    expect(styleSource).toContain("[data-aiflow-business-center]");
    expect(
      (
        styleSource.match(
          /\[data-aiflow-business-center\] > div > div:first-child \{/g
        ) ?? []
      ).length
    ).toBe(1);
    expect(styleSource).toContain(
      "[data-aiflow-business-center] > div > div:first-child > div > div > p"
    );
    expect(styleSource).toContain("min-height: 48px;");
    expect(styleSource).toContain(
      "[data-aiflow-designer] [data-aiflow-workflow-canvas]"
    );
    expect(styleSource).toContain(
      "[data-aiflow-designer] > [data-aiflow-workflow-canvas]"
    );
    expect(styleSource).toContain("order: 2;");
    expect(styleSource).toContain(
      "[data-aiflow-designer] > [data-structured-run-input]"
    );
    expect(styleSource).toContain("[data-aiflow-warehouse] > div > .grid");
    expect(styleSource).toContain(
      "[data-aiflow-warehouse] > div > div:first-child > select"
    );
    expect(styleSource).toContain("min-height: 0;");
    expect(styleSource).toContain("height: 44px;");
    expect(styleSource).toContain("[data-aiflow-process-detail]");
    expect(styleSource).toContain("[data-aiflow-system-config]");
    expect(styleSource).not.toContain(
      'div:has(> aside button[title="收起配置导航"])'
    );
    expect(styleSource).toContain('button[aria-label="收起已启动流程导航"]');
    expect(styleSource).toContain('button[aria-label="展开已启动流程导航"]');
  });

  it("统一字号层级覆盖设计器画布标签和导出的 SVG", () => {
    expect(styleSource).toContain("--aiflow-type-meta: 0.8125rem;");
    expect(styleSource).toContain("--aiflow-type-control: 0.875rem;");
    expect(styleSource).toContain("--aiflow-type-body: 1rem;");
    expect(styleSource).toContain("--aiflow-type-section: 1.125rem;");
    expect(styleSource).toContain("--aiflow-type-page-title: 1.5rem;");
    expect(styleSource).toContain("--aiflow-type-display: 1.75rem;");
    expect(styleSource).toContain("font-family: var(--aiflow-font-sans);");
    expect(styleSource).toContain(
      "font-size: var(--aiflow-type-control) !important;"
    );
    expect(styleSource).toContain('[class*="text-[9px]"]');
    expect(styleSource).toContain('[class*="text-xs"]');
    expect(styleSource).toContain('[class*="text-[13px]"]');
    expect(styleSource).toContain('[class*="text-sm"]');
    expect(styleSource).toContain('[class*="text-base"]');
    expect(styleSource).toContain(':where([class*="text-lg"])');
    expect(styleSource).toContain(':where([class*="text-xl"])');
    expect(styleSource).toContain(
      '[class*="text-2xl"], [class*="text-3xl"], [class*="text-4xl"], [class*="text-5xl"], [class*="text-6xl"], [class*="text-7xl"], [class*="text-8xl"], [class*="text-9xl"]'
    );
    expect(styleSource).toContain(
      "line-height: var(--aiflow-leading-page-title) !important;"
    );
    expect(styleSource).toContain(
      "line-height: var(--aiflow-leading-section) !important;"
    );
    expect(styleSource).toContain(
      "line-height: var(--aiflow-leading-control) !important;"
    );
    expect(styleSource).not.toContain("--aiflow-type-page-title: 1.25rem;");
    expect(canvasSource).toContain(
      'font-size="14" font-family="Arial, sans-serif"'
    );
    expect(canvasSource).toContain(
      'font-size="14" font-family="Arial, sans-serif"'
    );
    expect(canvasSource).not.toContain(
      'font-size="10" font-family="Arial, sans-serif"'
    );
    expect(canvasSource).toContain(
      'className="aiflow-type-control grid min-w-0 gap-1 font-medium text-muted-foreground"'
    );
    expect(canvasSource).toContain(
      'className="aiflow-type-body font-normal text-muted-foreground"'
    );
    expect(canvasSource).not.toContain("text-[10px]");
    expect(canvasSource).not.toContain("text-[11px]");
    expect(styleSource).toContain("font-size: var(--aiflow-type-page-title);");
    expect(styleSource).toContain("font-size: var(--aiflow-type-section);");
  });

  it("设计器和成员授权弹窗不请求可选 LLM 模型目录", () => {
    expect(homeSource).not.toContain("workflow.runtimeModels.useQuery");
    expect(homeSource).toContain("权限感知设计器");
    expect(homeSource).not.toContain("当前已发现 ${models.length} 个可用模型");
  });

  it("运行节点详情对字段值、说明和展开控件使用统一字号语义", () => {
    expect(runPayloadDetailsSource).toContain(
      'className="aiflow-type-section-title mb-2 font-semibold text-foreground"'
    );
    expect(runPayloadDetailsSource).toContain(
      'className="aiflow-type-code break-all font-mono text-muted-foreground"'
    );
    expect(runPayloadDetailsSource).toContain(
      'className="aiflow-type-code max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-border p-2 [overflow-wrap:anywhere]"'
    );
    expect(runPayloadDetailsSource).toContain(
      'className="aiflow-type-body min-w-0 whitespace-pre-wrap break-words text-foreground"'
    );
    expect(runPayloadDetailsSource).toContain(
      'className="aiflow-type-control flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"'
    );
    expect(runPayloadDetailsSource).toContain(
      'className="aiflow-type-body rounded-md border border-dashed border-border px-3 py-2 text-muted-foreground"'
    );
    expect(runPayloadDetailsSource).not.toContain("text-[10px]");
    expect(runPayloadDetailsSource).not.toContain("text-[11px]");
    expect(runPayloadDetailsSource).not.toContain("text-xs");
  });

  it("流程实例详情按信息职责使用统一字号，不保留局部任意字号", () => {
    expect(instanceDetailSource).toContain(
      'className="aiflow-type-section-title font-semibold text-foreground"'
    );
    expect(instanceDetailSource).toContain(
      'className="aiflow-type-body mt-1 text-muted-foreground"'
    );
    expect(instanceDetailSource).toContain(
      'className="aiflow-type-meta font-medium text-muted-foreground"'
    );
    expect(instanceDetailSource).toContain(
      'className="aiflow-type-control flex min-h-11 cursor-pointer items-center justify-between'
    );
    expect(instanceDetailSource).not.toContain("text-[10px]");
    expect(instanceDetailSource).not.toContain("text-xs");
    expect(instanceDetailSource).not.toContain("text-sm");
    expect(instanceDetailSource).not.toContain("text-lg");
  });

  it("已启动流程窄屏使用单行视图选择器并将刷新放入标题行", () => {
    const navigationStart = processWorkbenchSource.indexOf(
      'data-workbench-view-navigation=""'
    );
    const navigationEnd = processWorkbenchSource.indexOf(">", navigationStart);
    const navigationSource = processWorkbenchSource.slice(
      navigationStart,
      navigationEnd
    );

    expect(processWorkbenchSource).toContain('data-workbench-navigation=""');
    expect(processWorkbenchSource).toContain(
      'data-workbench-navigation-help=""'
    );
    expect(processWorkbenchSource).toContain(
      '<summary className="aiflow-type-control flex min-h-11 cursor-pointer list-none items-center justify-between gap-2'
    );
    expect(processWorkbenchSource).toContain(
      "人工操作由服务端暂停和续跑；移交、退回与批量处理逐项执行，任务仅在当前流程授权范围内可见。"
    );
    expect(navigationStart).toBeGreaterThanOrEqual(0);
    expect(navigationSource).toContain('aria-label="已启动流程视图"');
    expect(processWorkbenchSource).not.toContain("移动端切换已启动流程导航");
    expect(processWorkbenchSource).toContain('data-workbench-view-select=""');
    expect(processWorkbenchSource).toContain(
      "onChange={event => changeView(event.target.value as View)}"
    );
    expect(navigationSource).toContain('aria-label="已启动流程视图"');
    expect(navigationSource).toContain(
      'className="hidden min-w-0 lg:mt-2 lg:grid lg:grid-cols-1 lg:gap-2"'
    );
    expect(styleSource).not.toContain("[data-workbench-view-navigation] {");
    expect(processWorkbenchSource).toContain('aria-label="刷新当前视图"');
    expect(processWorkbenchSource).toContain(
      'className="aiflow-type-body mt-1 text-muted-foreground"'
    );
  });

  it("系统配置窄屏导航收敛为单行选择器并隐藏重复路径", () => {
    expect(systemConfigSource).toContain('data-system-config-navigation=""');
    expect(systemConfigSource).toContain('data-system-config-tabs=""');
    expect(systemConfigSource).toContain('data-system-config-mobile-select=""');
    expect(systemConfigSource).toContain('data-system-config-view-select=""');
    expect(systemConfigSource).toContain(
      "onChange={event => setTab(event.target.value as Tab)}"
    );
    expect(systemConfigSource).toContain(
      'className="aiflow-type-body mx-auto mt-1 max-w-sm leading-5 text-muted-foreground"'
    );
    expect(systemConfigSource).toContain(
      'className="hidden min-w-0 lg:mt-2 lg:grid lg:grid-cols-1 lg:gap-2'
    );
    expect(systemConfigSource).toContain(
      'aria-current={tab === item.id ? "page" : undefined}'
    );
    expect(systemConfigSource).toContain(
      'className={collapsed ? "lg:hidden" : "truncate"}'
    );
    expect(systemConfigSource).toContain('data-system-config-breadcrumb=""');
    expect(styleSource).toContain("[data-system-config-navigation]");
    expect(styleSource).not.toContain("[data-system-config-tabs]");
    expect(styleSource).toContain("[data-system-config-breadcrumb]");
    expect(styleSource).toContain("display: none !important;");
    expect(styleSource).not.toMatch(
      /@media \(max-width: 1023px\)[\s\S]*?\[data-system-config-tabs\]\s*\{[^}]*display: grid/
    );
  });

  it("各级页签在窄屏换行而不把关键入口推到横向滚动区", () => {
    expect(homeSource).toContain("grid min-h-12 min-w-0 grid-cols-2");
    expect(homeSource).toContain("grid min-w-0 grid-cols-3 gap-1");
    expect(organizationPageSource).toContain("grid min-w-0 grid-cols-3 gap-1");
    expect(processWorkbenchRunTabSource).toContain(
      "grid min-w-0 grid-cols-2 gap-1"
    );
    expect(processDetailPageSource).toContain(
      "grid h-auto w-full min-w-0 grid-cols-3"
    );
    expect(canvasSource).toContain("grid min-w-0 grid-cols-2 gap-1.5");
  });

  it("服务端点窄屏使用摘要卡，空状态和管理操作不依赖宽表格", () => {
    expect(projectWorkspaceSource).toContain(
      'className="min-h-11 min-[1024px]:min-h-10"'
    );
    expect(projectWorkspaceSource).toContain(
      "divide-y divide-border lg:hidden"
    );
    expect(projectWorkspaceSource).toContain("hidden overflow-x-auto lg:block");
    expect(projectWorkspaceSource).toContain(
      "min-h-11 w-full sm:w-auto min-[1024px]:min-h-10"
    );
    expect(projectWorkspaceSource).toContain('id="service-endpoint-ref-code"');
    expect(projectWorkspaceSource).toContain("<span>端点引用名</span>");
    expect(projectWorkspaceSource).toContain("{form.secretRef.trim() ? (");
    expect(projectWorkspaceSource).toContain("认证请求配置");
    expect(projectWorkspaceSource).toContain(
      "登记服务地址和密钥引用，供当前业务的流程调用；请勿填写实际密钥。"
    );
    expect(projectWorkspaceSource).toContain(
      "未填写密钥引用：调用不附加认证请求头。"
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-control block space-y-1 font-medium text-muted-foreground"'
    );
    expect(projectWorkspaceSource).toContain(
      'className="aiflow-type-body space-y-2"'
    );
    expect(projectWorkspaceSource).toContain(
      'pattern="[A-Za-z][A-Za-z0-9_]{1,63}"'
    );
    expect(projectWorkspaceSource).toContain(
      'pattern="env:FLOW_SECRET_[A-Z0-9_]{2,128}"'
    );
    expect(projectWorkspaceSource).toContain('pattern="[A-Za-z0-9-]{1,128}"');
    expect(projectWorkspaceSource).toContain(
      'pattern="[A-Za-z][A-Za-z0-9._-]{0,31}"'
    );
    expect(projectWorkspaceSource).toContain(
      "仅支持HTTP/HTTPS及80、443端口；地址不得含账号密码，调用时会拒绝私网地址。"
    );
    expect(projectWorkspaceSource).toContain(
      'className="min-h-11 text-sm min-[1024px]:min-h-10"'
    );
    expect(projectWorkspaceSource).toContain(
      "aiflow-type-control inline-flex min-h-11 items-center px-2 text-aiflow-info hover:underline"
    );
    expect(projectWorkspaceSource).toContain(
      "尚未登记服务端点。项目控制流程中的 HTTP/REST/METHOD"
    );
    expect(projectWorkspaceSource).toMatch(
      /<p className="aiflow-type-body leading-5 text-muted-foreground">\s*保存后，在流程节点中填写端点引用名（EndpointRef）和相对路径。/
    );
  });

  it("新增流程表单为文本与选择字段提供持久标签和手机触控高度", () => {
    for (const field of [
      ["new-workflow-code", "流程代号"],
      ["new-workflow-name", "流程名称"],
      ["new-workflow-description", "流程说明（可选）"],
      ["new-workflow-type", "流程类型"],
      ["new-workflow-source", "创建方式"],
    ]) {
      expect(projectWorkspaceSource).toContain(`id="${field[0]}"`);
      expect(projectWorkspaceSource).toContain(`<span>${field[1]}</span>`);
    }
    expect(projectWorkspaceSource).toContain('id="new-workflow-data-source"');
    expect(projectWorkspaceSource).toContain("aiflow-type-control min-h-11");
    expect(projectWorkspaceSource).toContain(
      "aiflow-type-body leading-5 text-muted-foreground"
    );
  });

  it("窄屏流程卡在下划线分段处换行，同时保留完整可访问名称", () => {
    expect(projectWorkspaceSource).toContain(
      'name.replaceAll("_", "_\\u200b")'
    );
    expect(projectWorkspaceSource).toContain("aria-label={workflow.name}");
    expect(projectWorkspaceSource).toContain("title={workflow.name}");
    expect(projectWorkspaceSource).toContain(
      "{displayWorkflowName(workflow.name)}"
    );
  });

  it("桌面流程表格显示完整可换行名称，并与窄屏保持一致", () => {
    const desktopTableStart = projectWorkspaceSource.indexOf(
      '<div className="hidden overflow-x-auto xl:block">'
    );
    const mobileCardsStart = projectWorkspaceSource.indexOf(
      '<div className="grid gap-3 p-3 xl:hidden">',
      desktopTableStart
    );
    const desktopTable = projectWorkspaceSource.slice(
      desktopTableStart,
      mobileCardsStart
    );

    expect(desktopTableStart).toBeGreaterThanOrEqual(0);
    expect(mobileCardsStart).toBeGreaterThan(desktopTableStart);
    expect(desktopTable).toContain("aria-label={workflow.name}");
    expect(desktopTable).toContain("title={workflow.name}");
    expect(desktopTable).toContain("{displayWorkflowName(workflow.name)}");
    expect(desktopTable).toContain(
      "aiflow-type-body min-w-0 break-words font-medium text-foreground"
    );
    expect(desktopTable).toContain(
      "aiflow-type-body mt-1 line-clamp-2 break-words text-muted-foreground"
    );
    expect(desktopTable).not.toContain("truncate font-medium text-foreground");
  });

  it("服务端点启用和停用必须经对象级确认并说明调用影响", () => {
    expect(projectWorkspaceSource).toContain("const [statusConfirmation");
    expect(projectWorkspaceSource).toContain("requestStatusChange(endpoint)");
    expect(projectWorkspaceSource).toContain("确认停用服务端点");
    expect(projectWorkspaceSource).toContain("确认启用服务端点");
    expect(projectWorkspaceSource).toContain(
      "后续引用此 EndpointRef 的任务将无法解析端点并执行失败；流程定义和历史记录会保留。"
    );
    expect(projectWorkspaceSource).toContain("本次操作不会立即发送外部请求。");
    expect(projectWorkspaceSource).toContain("AlertDialogAction>");
    expect(projectWorkspaceSource).not.toContain(
      "setStatus.mutate({ projectId, id: endpoint.id"
    );
    expect(projectWorkspaceSource).toContain(
      'aria-label={`${endpoint.status === "active" ? "停用" : "启用"}服务端点：${endpoint.name}（${endpoint.refCode}）`}'
    );
  });

  it("服务端点明确显示目标环境并说明标签不代表网络隔离", () => {
    expect(projectWorkspaceSource).toContain(
      'id="service-endpoint-target-environment"'
    );
    expect(projectWorkspaceSource).toContain("请选择目标环境");
    expect(projectWorkspaceSource).toContain("未分类");
    expect(projectWorkspaceSource).toContain(
      "设置目标环境：${endpoint.name}（${endpoint.refCode}）"
    );
    expect(projectWorkspaceSource).toContain(
      "环境标签不改变调用地址，也不提供网络隔离。"
    );
    expect(projectWorkspaceSource).toContain(
      "setServiceEndpointEnvironment.useMutation"
    );
  });
});
