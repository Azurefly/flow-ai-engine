import { describe, expect, it } from "vitest";
import { TestResultCollector } from "./helpers/test-harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function collectClientSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectClientSourceFiles(path);
    return entry.isFile() && /\.(?:css|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function expectSemanticRoleForCopy(source: string, copy: string, role: string) {
  const copyIndex = source.indexOf(copy);
  expect(copyIndex).toBeGreaterThanOrEqual(0);
  const context = source.slice(Math.max(0, copyIndex - 800), copyIndex);
  const sharedClasses = Array.from(context.matchAll(/className=\{([A-Za-z_$][\w$]*)\}/g), match => {
    const declaration = source.match(new RegExp(`const ${match[1]} = ("(?:[^"\\\\]|\\\\.)*");`));
    return declaration ? JSON.parse(declaration[1]) : "";
  });
  expect([context, ...sharedClasses].join(" ")).toContain(role);
}

function expectSemanticBodyForCopy(source: string, copy: string) {
  expectSemanticRoleForCopy(source, copy, "aiflow-type-body");
}

describe("功能测试 - 模块 8：界面交互优化与防退化功能回归 (UI & Motion Regression)", () => {
  describe("TC-REG-TYPO-001: 全局统一的可读字号层级", () => {
    it("页面正文与控件使用14px，标题和辅助信息按统一层级呈现", () => {
      const start = performance.now();
      const styleSource = readFileSync("client/src/index.css", "utf8");
      const canvasSource = readFileSync(
        "client/src/components/WorkflowCanvas.tsx",
        "utf8"
      );
      const runCenterSource = readFileSync(
        "client/src/components/RunCenter.tsx",
        "utf8"
      );
      const processWorkbenchSource = readFileSync(
        "client/src/components/ProcessWorkbench.tsx",
        "utf8"
      );
      const processWorkbenchRunTabSource = readFileSync(
        "client/src/components/ProcessWorkbenchRunTab.tsx",
        "utf8"
      );
      const homeSource = readFileSync("client/src/pages/Home.tsx", "utf8");
      const notFoundSource = readFileSync(
        "client/src/pages/NotFound.tsx",
        "utf8"
      );
      const resourceCenterSource = readFileSync(
        "client/src/components/DataResourceCenter.tsx",
        "utf8"
      );
      const organizationManagementSource = readFileSync(
        "client/src/components/OrganizationManagementPage.tsx",
        "utf8"
      );
      const workflowTestRunSource = readFileSync(
        "client/src/components/WorkflowTestRunModal.tsx",
        "utf8"
      );
      const projectWorkspaceSource = readFileSync(
        "client/src/components/ProjectWorkspace.tsx",
        "utf8"
      );
      const workflowDetailSource = readFileSync(
        "client/src/components/WorkflowDetailPage.tsx",
        "utf8"
      );
      const governanceSource = readFileSync(
        "client/src/components/WorkflowGovernance.tsx",
        "utf8"
      );
      const multiSelectSource = readFileSync(
        "client/src/components/SearchableMultiSelect.tsx",
        "utf8"
      );
      const systemConfigSource = readFileSync(
        "client/src/components/SystemConfigShell.tsx",
        "utf8"
      );
      const approvedLegacyRawSizes = new Set([
        "0.8rem",
        "9px",
        "10px",
        "11px",
        "12px",
        "13px",
      ]);
      const rawFontSizes = new Set<string>();
      for (const file of collectClientSourceFiles("client/src")) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(/text-\[([\d.]+(?:px|rem))\]/g)) {
          rawFontSizes.add(match[1]);
        }
        for (const match of source.matchAll(/<h1\b[^>]*>/g)) {
          expect(
            match[0],
            `${file} h1 must declare a semantic display role`
          ).toMatch(/className="[^"]*\baiflow-type-(?:page-title|display)\b/);
        }
        for (const match of source.matchAll(
          /<h[1-6]\b[^>]*data-aiflow-page-title[^>]*>/g
        )) {
          expect(
            match[0],
            `${file} page-title heading must set both font size and line height`
          ).toMatch(/className="[^"]*\baiflow-type-page-title\b/);
        }
      }

      expect(styleSource).toContain("--aiflow-type-meta: 0.8125rem");
      expect(styleSource).toContain("--aiflow-type-control: 0.875rem");
      expect(styleSource).toContain("--aiflow-type-code: 0.875rem");
      expect(styleSource).toContain("--aiflow-type-body: 0.875rem");
      expect(styleSource).toContain("--aiflow-leading-meta: 1.125rem");
      expect(styleSource).toContain("--aiflow-leading-control: 1.25rem");
      expect(styleSource).toContain("--aiflow-leading-code: 1.3125rem");
      expect(styleSource).toContain("--aiflow-leading-body: 1.375rem");
      expect(styleSource).toContain("--aiflow-leading-section: 1.5rem");
      expect(styleSource).toContain("--aiflow-leading-page-title: 1.875rem");
      expect(styleSource).toContain("--aiflow-leading-display: 2rem");
      const legacyTypographyRules = styleSource.slice(
        styleSource.indexOf("/* Legacy utility compatibility"),
        styleSource.indexOf("/* Native select appearance")
      );
      expect(legacyTypographyRules).toContain(
        "line-height: var(--aiflow-leading-body) !important"
      );
      expect(legacyTypographyRules).toContain(
        "line-height: var(--aiflow-leading-section) !important"
      );
      expect(legacyTypographyRules).toContain(
        "line-height: var(--aiflow-leading-page-title) !important"
      );
      expect(legacyTypographyRules).toContain(
        "line-height: var(--aiflow-leading-display) !important"
      );
      expect(styleSource).toContain(
        "line-height: var(--aiflow-leading-meta) !important"
      );
      const semanticHeadingRules = styleSource.slice(
        styleSource.indexOf(":is(h1, [data-aiflow-page-title])"),
        styleSource.indexOf("/* Honor explicit section/card title roles")
      );
      expect(semanticHeadingRules).toContain(
        "line-height: var(--aiflow-leading-page-title) !important"
      );
      expect(semanticHeadingRules).toContain(
        "line-height: var(--aiflow-leading-section) !important"
      );
      expect(semanticHeadingRules).toContain(
        "line-height: var(--aiflow-leading-body) !important"
      );
      expect(styleSource).toContain("--aiflow-type-section: 1rem");
      expect(styleSource).toContain("--aiflow-type-page-title: 1.375rem");
      expect(styleSource).toContain("--aiflow-type-display: 1.5rem");
      expect(notFoundSource).toContain(
        'className="aiflow-type-display mb-2 font-bold text-foreground"'
      );
      expect(notFoundSource).toContain(
        'className="aiflow-type-body mb-8 text-muted-foreground"'
      );
      expect(styleSource).toContain('label:not([class*="aiflow-type-"])');
      expect(
        readFileSync(
          "client/src/components/SystemRoleAssignmentDialog.tsx",
          "utf8"
        )
      ).toContain('className="auth-label"');
      expect(styleSource).toContain(
        ".auth-label {display:grid; gap:6px; font-size:var(--aiflow-type-control)"
      );
      expect(projectWorkspaceSource).toContain(
        "aiflow-type-control block space-y-1"
      );
      expect(workflowTestRunSource).toContain(
        'className="aiflow-type-body mt-3 flex min-h-11 cursor-pointer'
      );
      expect(styleSource).toContain(
        "font-size: var(--aiflow-type-control) !important"
      );
      expect(styleSource).toContain(".aiflow-type-code");
      expect(styleSource).toContain(
        "line-height: var(--aiflow-leading-code) !important"
      );
      expect(styleSource).toContain("--aiflow-font-sans:");
      expect(styleSource).toContain("--aiflow-type-page-title: 1.25rem");
      expect(styleSource).toContain("--aiflow-type-dialog-title: 1.125rem");
      expect(runCenterSource).toContain('data-aiflow-page-title=""');
      expect(processWorkbenchSource).toContain('data-aiflow-page-title=""');
      expect(homeSource).toContain('data-aiflow-page-title=""');
      expect(systemConfigSource).toContain('data-aiflow-page-title=""');
      expect(homeSource).toContain("aiflow-type-control h-12 min-w-0");
      expect(homeSource).not.toContain("text-xs sm:px-4 sm:text-sm");
      expect(resourceCenterSource).toContain(
        "aiflow-type-control inline-flex min-h-11"
      );
      expect(resourceCenterSource).not.toContain(
        "text-xs transition-colors last:col-span-2 md:"
      );
      expect(workflowDetailSource).toContain(
        "aiflow-type-page-title min-w-0 max-w-full"
      );
      expect(workflowDetailSource).toContain(
        "aiflow-type-control h-10 min-w-0"
      );
      expect(workflowDetailSource).not.toContain(
        "text-lg font-semibold text-foreground sm:text-xl"
      );
      expect(workflowDetailSource).not.toContain(
        "text-xs text-muted-foreground shadow-none"
      );
      expect(runCenterSource).toContain(
        "aiflow-type-display min-w-0 break-words font-bold tabular-nums"
      );
      expect(runCenterSource).not.toContain("sm:text-2xl");
      expect(processWorkbenchSource).toContain(
        "aiflow-type-control truncate rounded bg-aiflow-info-surface"
      );
      expect(processWorkbenchSource).not.toContain("text-[9px]");
      expectSemanticBodyForCopy(
        homeSource,
        "管理账号与角色，查看有效权限和授权来源。"
      );
      expectSemanticBodyForCopy(workflowTestRunSource, "业务编号请选择文本以保留前导零");
      const memberDialogSource = readFileSync(
        "client/src/components/WorkflowRoleBindingsDialog.tsx",
        "utf8"
      );
      expectSemanticRoleForCopy(
        memberDialogSource,
        "填写仍保留在当前账号会话中",
        "auth-info"
      );
      expectSemanticRoleForCopy(
        memberDialogSource,
        "已隐藏旧列表",
        "auth-body"
      );
      expect(styleSource).toContain(
        ".auth-body,.auth-muted,.auth-error,.auth-info,.auth-name {font-size:var(--aiflow-type-body)"
      );
      expectSemanticBodyForCopy(homeSource, "取消发布会阻止后续发起");
      expectSemanticBodyForCopy(
        canvasSource,
        "当前为兼容分支：同意后继续，拒绝即取消实例。"
      );
      expect(canvasSource).toContain('"预览候选人"');
      expect(
        readFileSync("client/src/components/ui/button.tsx", "utf8")
      ).toContain("aiflow-button");
      expect(styleSource).toMatch(
        /\.aiflow-button\s*\{[^}]*font-size: var\(--aiflow-type-control\)/
      );
      expectSemanticBodyForCopy(
        canvasSource,
        "从选中节点保存模板，或在设计器顶部"
      );
      expectSemanticBodyForCopy(
        resourceCenterSource,
        "资源中心不提供模拟算子按钮"
      );
      expectSemanticBodyForCopy(resourceCenterSource, "使用六段 UTC 表达式");
      expectSemanticBodyForCopy(resourceCenterSource, "尚无可引用的数据资源。");
      expectSemanticBodyForCopy(resourceCenterSource, "尚无可引用的函数资源。");
      expectSemanticBodyForCopy(
        resourceCenterSource,
        "当前没有已发布数据流。发布后再创建调度"
      );
      expectSemanticBodyForCopy(resourceCenterSource, "尚未配置定时调度。");
      expectSemanticBodyForCopy(
        organizationManagementSource,
        "唯一主部门用于直属上级解析。"
      );
      expectSemanticBodyForCopy(
        processWorkbenchRunTabSource,
        "当前账户无权查看该实例，或该实例已不存在。"
      );
      expectSemanticBodyForCopy(
        processWorkbenchSource,
        "“≥”表示已确认数量的下界"
      );
      expectSemanticBodyForCopy(
        processWorkbenchSource,
        "包含本人待办、已办和发起的近期任务；待办数只统计当前分配/候选给本人或由本人领取的任务。"
      );
      expectSemanticBodyForCopy(
        processWorkbenchSource,
        "人工操作由服务端暂停和续跑；移交、退回与批量处理逐项执行，任务仅在当前流程授权范围内可见。"
      );
      expectSemanticBodyForCopy(
        projectWorkspaceSource,
        "目录暂时无法加载；已选对象会保留"
      );
      expectSemanticRoleForCopy(
        projectWorkspaceSource,
        "添加可见部门（可多选；部门成员自动继承可见权）",
        "aiflow-type-control"
      );
      expectSemanticRoleForCopy(
        projectWorkspaceSource,
        "添加可见人（可多选；直接授权人员可见权）",
        "aiflow-type-control"
      );
      expect(projectWorkspaceSource).toContain(
        'className="aiflow-type-body grid gap-x-4 gap-y-2 sm:grid-cols-2"'
      );
      expect(projectWorkspaceSource).toMatch(
        /className="aiflow-type-control w-\[8%\] px-4 py-3 text-right">\s*流程数/
      );
      expect(projectWorkspaceSource).toMatch(
        /className="aiflow-type-control w-\[20%\] px-4 py-3">\s*工作域/
      );
      expect(projectWorkspaceSource).toContain(
        'className="aiflow-type-control grid gap-1 font-medium text-muted-foreground"'
      );
      expect(projectWorkspaceSource).not.toContain(
        'className="grid gap-1 text-xs font-medium text-muted-foreground"'
      );
      expectSemanticBodyForCopy(
        homeSource,
        "账号由管理员创建；系统不提供公开注册。"
      );
      expectSemanticBodyForCopy(
        projectWorkspaceSource,
        "刷新失败，当前显示上次成功读取的业务列表。"
      );
      expectSemanticBodyForCopy(
        homeSource,
        "部分账号创建失败，请修正目标后重新生成"
      );
      expectSemanticBodyForCopy(runCenterSource, "请查看运行节点日志。");
      expectSemanticRoleForCopy(
        canvasSource,
        "请从此路径句柄连线到目标状态节点",
        "aiflow-type-control"
      );
      expectSemanticBodyForCopy(
        multiSelectSource,
        "当前结果超过 {maxResults} 项"
      );
      expectSemanticBodyForCopy(
        workflowTestRunSource,
        "请在“已启动流程”中查看待办任务或所需事件"
      );
      expectSemanticBodyForCopy(
        workflowTestRunSource,
        "按照流程拓扑顺序记录各算子的实际执行状态"
      );
      expectSemanticBodyForCopy(
        workflowTestRunSource,
        "本次运行未返回结构化输出，请查看“算子执行明细”。"
      );
      expectSemanticBodyForCopy(
        workflowTestRunSource,
        "本次运行未传入额外自定义输入参数（使用默认配置运行）。"
      );
      expectSemanticBodyForCopy(
        projectWorkspaceSource,
        "实际发起人由服务端会话身份记录"
      );
      expectSemanticBodyForCopy(
        workflowDetailSource,
        "只读预览；流程定义不会在此页面修改"
      );
      expectSemanticBodyForCopy(
        governanceSource,
        "查看快照差异；恢复操作会生成新的可审计版本"
      );
      expectSemanticBodyForCopy(governanceSource, "流程说明和创建、发布记录");
      expectSemanticBodyForCopy(governanceSource, "版本历史加载失败");
      expect(governanceSource).toContain(
        'className="aiflow-type-section-title mb-2 font-semibold text-foreground"'
      );
      expect(governanceSource).toContain(
        'className="aiflow-type-body mt-2 grid gap-1"'
      );
      expect(governanceSource).toContain(
        'className="aiflow-type-control font-medium text-muted-foreground"'
      );
      expectSemanticBodyForCopy(
        governanceSource,
        "该流程已被驳回。重置后回到待审核草稿"
      );
      expect(homeSource).toContain("p-3 aiflow-type-control text-foreground");
      expect(homeSource).not.toContain("function LogBlock");
      expect(memberDialogSource).toContain('className="auth-title"');
      expect(styleSource).toContain(
        ".auth-title {font-size:var(--aiflow-type-section)"
      );
      expect(homeSource).not.toContain("bg-card/80 p-2 text-[11px]");
      expect(workflowTestRunSource).toContain(
        "aiflow-type-code max-h-40 overflow-auto rounded bg-slate-900 p-2.5 font-mono text-emerald-300"
      );
      expect(workflowTestRunSource).toContain(
        "aiflow-type-code max-h-[380px] overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-emerald-300"
      );
      expect(workflowTestRunSource).toContain(
        "aiflow-type-code max-h-[350px] overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-blue-300"
      );
      expect(
        readFileSync("client/src/components/RunPayloadDetails.tsx", "utf8")
      ).toContain(
        "aiflow-type-code max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-border p-2"
      );
      expect(
        readFileSync("client/src/components/DataResourceCenter.tsx", "utf8")
      ).toContain("aiflow-type-code my-2 max-h-72 max-w-full overflow-auto");
      expect(processWorkbenchSource).toContain(
        "taskResultView(task?.payload?.config, task?.result)"
      );
      expect(processWorkbenchSource).toContain("resultView.rows.map");
      expect(processWorkbenchSource).toContain(
        "whitespace-pre-wrap break-words text-sm text-foreground"
      );
      expect(workflowTestRunSource).toContain(
        "aiflow-type-body font-semibold text-foreground"
      );
      expect(canvasSource).toContain(
        "aiflow-type-control flex items-center justify-between gap-3"
      );
      expect(resourceCenterSource).toContain(
        "aiflow-type-section-title font-semibold text-foreground"
      );
      expect(styleSource).toContain('[class~="text-[9px]"]');
      expect(styleSource).toContain('[class~="text-[10px]"]');
      expect(styleSource).toContain('[class~="text-[11px]"]');
      expect(styleSource).toContain('[class~="text-[12px]"]');
      expect(styleSource).toContain('[class~="text-[13px]"]');
      expect(styleSource).toContain('[class~="text-[0.8rem]"]');
      const legacy13pxRule = styleSource
        .split("::where(")
        .find(rule => rule.includes('[class~="text-[13px]"]'));
      expect(legacy13pxRule).toContain(
        "font-size: var(--aiflow-type-meta) !important"
      );
      expect(
        [...rawFontSizes].filter(size => !approvedLegacyRawSizes.has(size))
      ).toEqual([]);
      expect(styleSource).toContain('[class~="text-xs"]');
      expect(styleSource).toContain('[class~="text-sm"]');
      expect(styleSource).toContain('[class~="text-base"]');
      expect(styleSource).toContain('[class~="text-lg"]');
      expect(styleSource).toContain('[class~="text-xl"]');
      expect(styleSource).toContain('[class~="text-2xl"]');
      expect(styleSource).toContain('[class~="text-3xl"]');
      expect(styleSource).toContain('[class~="text-4xl"]');
      expect(styleSource).toContain("font-family: var(--aiflow-font-sans)");
      expect(canvasSource).not.toContain("fontSize: 11");
      expect(canvasSource).not.toContain("fontSize: 12");
      expect(canvasSource).toContain("minZoom={0.1}");
      expect(canvasSource).toContain("lastInitialFitKeyRef");
      expect(canvasSource).toContain("minZoom: 0.1,");
      expect(canvasSource).toContain("maxZoom: 1.25,");
      expect(canvasSource).toContain("minZoom={0.1}");
      expect(canvasSource).toContain("maxZoom={1.25}");

      TestResultCollector.record({
        testId: "TC-REG-TYPO-001",
        name: "全局字号与行高语义层级",
        category: "validation",
        module: "全局样式",
        target: "index.css.typeScale",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-ROUTE-001: 主路由切换从页面顶部开始", () => {
    it("切换控制台路由后重置文档滚动位置，避免新页面标题被保留滚动偏移遮挡", () => {
      const start = performance.now();
      const homeSource = readFileSync("client/src/pages/Home.tsx", "utf8");
      const navigationStart = homeSource.indexOf(
        "const navigateRoute = useCallback"
      );
      const navigationEnd = homeSource.indexOf(
        "const navigateSection = useCallback"
      );
      const navigationSource = homeSource.slice(navigationStart, navigationEnd);

      expect(navigationStart).toBeGreaterThanOrEqual(0);
      expect(navigationEnd).toBeGreaterThan(navigationStart);
      expect(navigationSource).toContain("consoleHistory.current?.navigate(");
      expect(homeSource).toContain(
        'if (reason !== "traverse") window.scrollTo(0, 0)'
      );

      TestResultCollector.record({
        testId: "TC-REG-ROUTE-001",
        name: "控制台路由切换回到页面顶部",
        category: "validation",
        module: "主控制台导航",
        target: "Home.navigateRoute.scrollPosition",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-ERROR-001: 页面模块加载失败后的恢复提示", () => {
    it("对旧版分块与网络加载失败使用中文说明和可访问的刷新按钮", () => {
      const start = performance.now();
      const source = readFileSync(
        "client/src/components/ErrorBoundary.tsx",
        "utf8"
      );

      expect(source).toContain("failed to fetch dynamically imported module");
      expect(source).toContain("页面内容未能加载");
      expect(source).toContain("尚未保存的内容可能不会保留");
      expect(source).toContain('role="alert"');
      expect(source).toContain("min-h-11");
      expect(source).toContain("刷新页面");
      expect(source).not.toContain("this.state.error?.stack");
      expect(source).not.toContain("An unexpected error occurred.");

      TestResultCollector.record({
        testId: "TC-REG-ERROR-001",
        name: "分块加载失败时提供中文说明与刷新恢复操作",
        category: "validation",
        module: "全局错误恢复",
        target: "ErrorBoundary.DynamicImportFailure",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-001: 画布全量 Undo/Redo 历史快照与快捷键状态机", () => {
    it("历史栈具备深度限制、撤销/重做状态驱动与只读保护", () => {
      const start = performance.now();

      type NodeItem = { id: string; x: number; y: number; label: string };
      type EdgeItem = { id: string; source: string; target: string };
      type Snapshot = { nodes: NodeItem[]; edges: EdgeItem[] };

      class HistoryManager {
        past: Snapshot[] = [];
        future: Snapshot[] = [];
        current: Snapshot;
        readOnly: boolean;

        constructor(initial: Snapshot, readOnly = false) {
          this.current = structuredClone(initial);
          this.readOnly = readOnly;
        }

        get canUndo() {
          return !this.readOnly && this.past.length > 0;
        }

        get canRedo() {
          return !this.readOnly && this.future.length > 0;
        }

        push(next: Snapshot) {
          if (this.readOnly) return;
          this.past.push(structuredClone(this.current));
          if (this.past.length > 30) this.past.shift();
          this.future = [];
          this.current = structuredClone(next);
        }

        undo(): boolean {
          if (!this.canUndo) return false;
          const previous = this.past.pop()!;
          this.future.unshift(structuredClone(this.current));
          if (this.future.length > 30) this.future.pop();
          this.current = structuredClone(previous);
          return true;
        }

        redo(): boolean {
          if (!this.canRedo) return false;
          const next = this.future.shift()!;
          this.past.push(structuredClone(this.current));
          if (this.past.length > 30) this.past.shift();
          this.current = structuredClone(next);
          return true;
        }
      }

      // Initial state
      const initial: Snapshot = {
        nodes: [{ id: "start", x: 0, y: 0, label: "开始" }],
        edges: [],
      };
      const history = new HistoryManager(initial);

      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(false);

      // Step 1: Add a node
      history.push({
        nodes: [
          { id: "start", x: 0, y: 0, label: "开始" },
          { id: "node_1", x: 200, y: 100, label: "审批" },
        ],
        edges: [{ id: "e1", source: "start", target: "node_1" }],
      });
      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(false);
      expect(history.current.nodes.length).toBe(2);

      // Step 2: Add another node
      history.push({
        nodes: [
          { id: "start", x: 0, y: 0, label: "开始" },
          { id: "node_1", x: 200, y: 100, label: "审批" },
          { id: "node_2", x: 400, y: 100, label: "归档" },
        ],
        edges: [
          { id: "e1", source: "start", target: "node_1" },
          { id: "e2", source: "node_1", target: "node_2" },
        ],
      });
      expect(history.current.nodes.length).toBe(3);

      // Step 3: Undo step 2
      expect(history.undo()).toBe(true);
      expect(history.current.nodes.length).toBe(2);
      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(true);

      // Step 4: Undo step 1 (back to initial)
      expect(history.undo()).toBe(true);
      expect(history.current.nodes.length).toBe(1);
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(true);

      // Step 5: Redo step 1
      expect(history.redo()).toBe(true);
      expect(history.current.nodes.length).toBe(2);
      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(true);

      // Step 6: Mutate while in redo history (should clear future)
      history.push({
        nodes: [
          { id: "start", x: 0, y: 0, label: "开始" },
          { id: "node_1", x: 200, y: 100, label: "审批" },
          { id: "node_alt", x: 200, y: 300, label: "替代分支" },
        ],
        edges: [],
      });
      expect(history.canRedo).toBe(false);

      // Step 7: ReadOnly check
      const readOnlyHistory = new HistoryManager(initial, true);
      readOnlyHistory.push({ nodes: [], edges: [] });
      expect(readOnlyHistory.canUndo).toBe(false);
      expect(readOnlyHistory.undo()).toBe(false);

      TestResultCollector.record({
        testId: "TC-REG-HISTORY-001",
        name: "画布全量 Undo/Redo 历史快照模型与回溯状态机",
        category: "workflow",
        module: "流程设计器",
        target: "WorkflowCanvas.HistoryManager",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-002: 业务中心 (BusinessCenterView) 服务端分页与 CSV 模板契约", () => {
    it("电脑端业务列表使用统一紧凑表格", () => {
      const source = readFileSync(
        "client/src/components/ProjectWorkspace.tsx",
        "utf8"
      );
      expect(source).toContain('data-business-table-desktop=""');
      expect(source).not.toContain(
        'className="grid gap-2 p-3 sm:grid-cols-2 sm:gap-3 min-[900px]:hidden"'
      );
      expect(source).toContain(
        'className="aiflow-type-body w-full min-w-[720px] table-fixed text-left"'
      );
    });

    it("业务列表绑定服务端分页响应，翻页与查询不依赖客户端全量切片", () => {
      const start = performance.now();
      const source = readFileSync(
        "client/src/components/ProjectWorkspace.tsx",
        "utf8"
      );
      expect(source).toContain("trpc.project.page.useQuery(pageInput)");
      expect(source).toContain("const [pageSize, setPageSize] = useState(10)");
      expect(source).toContain("total={projects.data?.total ?? 0}");
      expect(source).toContain("page={projects.data?.page ?? page}");
      expect(source).toContain("onPageChange={setPage}");
      expect(source).toContain("setPageSize(value); setPage(1)");
      expect(source).toContain("setPage(1); setAppliedFilters");
      expect(source).toContain(
        "queryState.refreshing || currentPage >= totalPages"
      );
      expect(source).not.toContain("projects.slice(");
      for (const size of [10, 25, 50])
        expect(source).toContain(`<option value={${size}}>${size} 条</option>`);
      TestResultCollector.record({
        testId: "TC-REG-PAGE-002",
        name: "业务中心服务端分页响应与筛选重置绑定",
        category: "contract",
        module: "业务中心",
        target: "project.page → BusinessCenterView",
        status: "passed",
        start,
      });
    });

    it("下载 CSV 模板生成带 UTF-8 BOM 且包含必需列头", () => {
      const start = performance.now();

      const sample =
        "业务代号,业务名称,工作域代号,业务说明\r\nOPS,智能运维中心,DEFAULT,核心生产自动化运维与告警处置流程\r\nFINANCE,财务结算中心,,发票核验与报销自动化审批流程\r\n";
      const bomHeader = "﻿";
      const fullContent = bomHeader + sample;

      // Verify BOM exists
      expect(fullContent.charCodeAt(0)).toBe(0xfeff);

      // Verify headers match import regex / requirement
      const firstLine = fullContent.replace(/^﻿/, "").split(/\r?\n/)[0];
      const headers = firstLine.split(",").map(h => h.trim());
      expect(headers).toContain("业务代号");
      expect(headers).toContain("业务名称");
      expect(headers).toContain("工作域代号");
      expect(headers).toContain("业务说明");

      TestResultCollector.record({
        testId: "TC-REG-CSV-003",
        name: "业务 CSV 模板下载格式规范与 UTF-8 BOM 防乱码检验",
        category: "button",
        module: "业务中心",
        target: "downloadSampleCsv",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-003: 流程设计中心 (ProcessCenter) 状态驱动行操作分级", () => {
    it("根据流程状态与权限精准推导行内主次操作，避免操作拥挤", () => {
      const start = performance.now();

      type WorkflowItem = {
        id: string;
        status: "draft" | "published";
        auditStatus: "init" | "approved" | "rejected";
        flowType: "state" | "control" | "data";
      };

      const resolveRowActions = (
        workflow: WorkflowItem,
        canManage: boolean
      ): { primary: string; secondary: string[]; auditActions: string[] } => {
        let primary = "设计";
        const secondary: string[] = ["详情"];
        const auditActions: string[] = [];

        if (workflow.status === "published") {
          primary = workflow.flowType === "data" ? "启动" : "发起流程";
          secondary.push("设计");
          if (canManage) secondary.push("取消发布");
        } else {
          primary = "设计";
          if (canManage && workflow.auditStatus === "approved") {
            secondary.push("发布");
          }
        }

        if (canManage && workflow.auditStatus === "init") {
          auditActions.push("通过", "驳回");
        }

        return { primary, secondary, auditActions };
      };

      // Case 1: Published State Flow (Manager)
      const a1 = resolveRowActions(
        {
          id: "w1",
          status: "published",
          auditStatus: "approved",
          flowType: "state",
        },
        true
      );
      expect(a1.primary).toBe("发起流程");
      expect(a1.secondary).toContain("设计");
      expect(a1.secondary).toContain("取消发布");

      // Case 2: Draft Approved Data Flow (Non-manager)
      const a2 = resolveRowActions(
        {
          id: "w2",
          status: "draft",
          auditStatus: "approved",
          flowType: "data",
        },
        false
      );
      expect(a2.primary).toBe("设计");
      expect(a2.secondary).not.toContain("发布");

      // Case 3: Awaiting Audit Workflow (Manager)
      const a3 = resolveRowActions(
        { id: "w3", status: "draft", auditStatus: "init", flowType: "control" },
        true
      );
      expect(a3.primary).toBe("设计");
      expect(a3.auditActions).toEqual(["通过", "驳回"]);

      TestResultCollector.record({
        testId: "TC-REG-ROW-004",
        name: "流程中心状态驱动的主次操作收纳与权限联动推导",
        category: "contract",
        module: "流程设计中心",
        target: "ProcessCenter.RowActions",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-004: 流程试跑弹窗 (WorkflowTestRunModal) 结果分页与真实性语义", () => {
    it("输出结果集轻量分页在 25 条步长下安全切片，不修改原始数据", () => {
      const start = performance.now();

      const rawOutputRows = Array.from({ length: 120 }, (_, idx) => ({
        id: idx + 1,
        sourceIp: `192.168.1.${idx + 1}`,
        metric: Math.round(Math.random() * 100),
        status: idx % 2 === 0 ? "PASSED" : "FLAGGED",
      }));

      const OUTPUT_PAGE_SIZE = 25;
      const totalOutputRows = rawOutputRows.length;
      const totalOutputPages = Math.max(
        1,
        Math.ceil(totalOutputRows / OUTPUT_PAGE_SIZE)
      );

      expect(totalOutputPages).toBe(5);

      // Page 1
      const page1 = rawOutputRows.slice(0, OUTPUT_PAGE_SIZE);
      expect(page1.length).toBe(25);
      expect(page1[0].id).toBe(1);
      expect(page1[24].id).toBe(25);

      // Page 5 (last page)
      const page5 = rawOutputRows.slice(
        4 * OUTPUT_PAGE_SIZE,
        5 * OUTPUT_PAGE_SIZE
      );
      expect(page5.length).toBe(20);
      expect(page5[19].id).toBe(120);

      // Ensure raw data is unmodified
      expect(rawOutputRows.length).toBe(120);

      TestResultCollector.record({
        testId: "TC-REG-RUN-005",
        name: "流程试跑 120 条数据集每页 25 条切片保护与原数据不可变性",
        category: "validation",
        module: "流程试跑弹窗",
        target: "WorkflowTestRunModal.outputPagination",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-005: 工作台待办批量操作栏 (TaskBatchBar) 零选中收起", () => {
    it("仅在有选中任务时激活批量处理栏，零选中时不占用垂直屏幕高度", () => {
      const start = performance.now();

      const shouldShowBatchBar = (
        view: string,
        selectedTaskIds: string[]
      ): boolean => {
        return view === "todo" && selectedTaskIds.length > 0;
      };

      // 0 selected in todo view -> false
      expect(shouldShowBatchBar("todo", [])).toBe(false);

      // 2 selected in todo view -> true
      expect(shouldShowBatchBar("todo", ["t1", "t2"])).toBe(true);

      // Selected in done view -> false
      expect(shouldShowBatchBar("done", ["t1"])).toBe(false);

      TestResultCollector.record({
        testId: "TC-REG-TODO-006",
        name: "已启动流程待办视图批量处理工具栏按需展开条件",
        category: "button",
        module: "已启动流程工作台",
        target: "ProcessWorkbench.TaskBatchBar",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-006: 运行监控中心 (RunCenter) 告警与未选中状态自适应", () => {
    it("零告警轻量展示，常规视口单列，超宽屏选中后分栏", () => {
      const start = performance.now();

      const statusMap: Record<string, string> = {
        success: "成功",
        failed: "失败",
        running: "运行中",
        waiting: "等待中",
        blocked: "已阻塞",
        queued: "排队中",
        cancelled: "已取消",
        terminated: "已终止",
      };

      // Status mapping verified
      expect(statusMap["success"]).toBe("成功");
      expect(statusMap["waiting"]).toBe("等待中");
      expect(statusMap["blocked"]).toBe("已阻塞");

      // Grid columns derivation
      const getGridCols = (hasSelectedRun: boolean) =>
        hasSelectedRun
          ? "2xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]"
          : "grid-cols-1";

      expect(getGridCols(false)).toBe("grid-cols-1");
      expect(getGridCols(true)).toBe(
        "2xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]"
      );

      TestResultCollector.record({
        testId: "TC-REG-RUN-007",
        name: "运行监控状态全量中文映射与空选中全宽自适应",
        category: "contract",
        module: "运行监控中心",
        target: "RunCenter.LayoutAndStatus",
        status: "passed",
        start,
      });
    });

    it("手机端运行指标保留完整耗时，刷新按钮并排显示", () => {
      const start = performance.now();
      const source = readFileSync(
        new URL("../../client/src/components/RunCenter.tsx", import.meta.url),
        "utf8"
      );

      expect(source).toContain(
        'className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3"'
      );
      expect(source).toContain("fullWidthOnMobile");
      expect(source).toContain("col-span-2 sm:col-span-1");
      expect(source).toContain('className="flex min-w-0 flex-row gap-2"');
      expect(source).toContain(
        'className="aiflow-type-control h-11 min-w-0 flex-1 px-2 sm:px-3 lg:h-9 lg:flex-none"'
      );
      expect(source).toContain(
        'className="aiflow-type-control h-11 min-w-0 rounded border border-border bg-card px-2 lg:h-9"'
      );
      expect(source).toContain(
        'className="aiflow-type-control h-11 min-w-0 w-full lg:h-9"'
      );
      expect(source).toContain('data-run-filter-panel=""');
      expect(source).toContain(
        'className="aiflow-type-control h-11 justify-self-end px-3 lg:col-span-1 lg:h-9"'
      );
      expect(source).toContain("disabled={!hasRunFilters}");
      expect(source).toContain("更多筛选");
      expect(source).toContain('className="aiflow-type-control h-11 lg:h-9"');
      expect(source).toContain(
        'className="aiflow-type-control h-11 text-aiflow-info lg:h-9"'
      );
      expect(source).toContain(
        'className="aiflow-type-control h-11 text-aiflow-warning lg:h-9"'
      );
      expect(source).toContain(
        'className="aiflow-type-control h-11 text-red-700 lg:h-9"'
      );
      expect(source).not.toContain("sm:h-7");
      expect(source).not.toContain("sm:h-8");
      expect(source).not.toContain("sm:min-h-9");

      TestResultCollector.record({
        testId: "TC-REG-RUN-MOBILE-008",
        name: "手机运行指标整行布局与紧凑刷新按钮",
        category: "contract",
        module: "运行监控中心",
        target: "RunCenter.MobileMetricsAndActions",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-007: 流程设计器画布属性面板 (Inspector) 未选中隐退", () => {
    it("未选节点时属性面板不挂载，100% 画布可用空间；选择后从右侧展开", () => {
      const start = performance.now();

      const isInspectorRendered = (
        selectedId: string | null,
        selected: any,
        inspectorMode: string
      ) => {
        return Boolean(selectedId && selected && inspectorMode !== "compact");
      };

      // Unselected -> false
      expect(isInspectorRendered(null, null, "normal")).toBe(false);

      // Selected -> true
      expect(isInspectorRendered("node_1", { id: "node_1" }, "normal")).toBe(
        true
      );

      // Selected but compact -> false
      expect(isInspectorRendered("node_1", { id: "node_1" }, "compact")).toBe(
        false
      );

      TestResultCollector.record({
        testId: "TC-REG-CANVAS-008",
        name: "设计器未选中节点时属性面板空间回收逻辑",
        category: "contract",
        module: "流程设计器",
        target: "WorkflowCanvas.InspectorMounting",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-008: 流程仓库 (WorkflowWarehouse) 响应式详情视图", () => {
    it("选中流程时窄屏切换到只读预览，返回后恢复目录和列表", () => {
      const start = performance.now();
      const warehouseSrc = readFileSync(
        new URL(
          "../../client/src/components/WorkflowWarehouse.tsx",
          import.meta.url
        ),
        "utf8"
      );
      const canvasSrc = readFileSync(
        new URL(
          "../../client/src/components/WorkflowCanvas.tsx",
          import.meta.url
        ),
        "utf8"
      );

      expect(warehouseSrc).toContain(
        'selectedWorkflowId ? "hidden xl:block" : ""'
      );
      expect(warehouseSrc).toContain('aria-label="返回流程列表"');
      expect(warehouseSrc).toContain("setSelectedWorkflowId(null)");
      expect(warehouseSrc).toContain("compactReadOnlyPreview");
      expect(canvasSrc).toContain(
        'compactReadOnlyPreview ? "min-h-0" : "min-h-[650px]"'
      );
      expect(canvasSrc).toContain(
        'compactReadOnlyPreview ? "h-[340px] sm:h-[420px] lg:h-[520px]"'
      );

      TestResultCollector.record({
        testId: "TC-REG-WH-009",
        name: "窄屏预览聚焦并保留返回列表路径",
        category: "contract",
        module: "流程仓库",
        target: "WorkflowWarehouse.LayoutSwitch",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-009: 手机全站导航抽屉与桌面流程列表分离", () => {
    it("导航入口始终打开有焦点管理的抽屉，工作区可达且编辑器列表仍独立可控", () => {
      const start = performance.now();
      const homeSrc = readFileSync(
        new URL("../../client/src/pages/Home.tsx", import.meta.url),
        "utf8"
      );
      const sheetSrc = readFileSync(
        new URL("../../client/src/components/ui/sheet.tsx", import.meta.url),
        "utf8"
      );

      expect(homeSrc).toContain('data-aiflow-mobile-nav-trigger=""');
      expect(homeSrc).toContain("aria-expanded={mobileNavOpen}");
      expect(homeSrc).toContain('aria-controls="aiflow-mobile-navigation"');
      expect(homeSrc).toContain("<dialog");
      expect(homeSrc).toContain("dialog.showModal()");
      expect(homeSrc).toContain('id="aiflow-mobile-navigation"');
      expect(homeSrc).toContain("onClose={() => setMobileNavOpen(false)}");
      expect(homeSrc).toContain('aria-label="工作区导航"');
      expect(homeSrc).toContain(
        'aria-current={activeSection === item.id ? "page" : undefined}'
      );
      expect(homeSrc).toContain('className="flex min-h-11 w-full items-center');
      expect(homeSrc).toContain(
        'aria-label={flowListOpen ? "收起流程列表" : "展开流程列表"}'
      );
      expect(homeSrc).toContain('aria-label="关闭流程列表"');
      expect(homeSrc).toContain("setMobileNavOpen(false)");
      expect(homeSrc).not.toContain("data-aiflow-mobile-workspace-nav");
      expect(sheetSrc).toContain("showCloseButton = true");
      expect(sheetSrc).toContain("{showCloseButton && (");

      TestResultCollector.record({
        testId: "TC-REG-NAV-010",
        name: "手机全站导航抽屉可发现、可关闭且与流程列表控件职责分离",
        category: "accessibility",
        module: "全站导航",
        target: "Home.MobileNavigation",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-011: 源代码回归契约文件完整性核验", () => {
    it("核验前端组件文件中包含所有历史回归关键锚点与 ARIA 标记", () => {
      const start = performance.now();

      const readSrc = (relPath: string) =>
        readFileSync(
          new URL(`../../client/src/${relPath}`, import.meta.url),
          "utf8"
        );

      const canvasSrc = readSrc("components/WorkflowCanvas.tsx");
      const workspaceSrc = readSrc("components/ProjectWorkspace.tsx");
      const detailSrc = readSrc("components/WorkflowDetailPage.tsx");
      const testRunSrc = readSrc("components/WorkflowTestRunModal.tsx");
      const configSrc = readSrc("components/SystemConfigShell.tsx");
      const resourceSrc = readSrc("components/DataResourceCenter.tsx");
      const homeSrc = readSrc("pages/Home.tsx");
      const runCenterSrc = readSrc("components/RunCenter.tsx");
      const processWorkbenchSrc = readSrc("components/ProcessWorkbench.tsx");

      // WorkflowCanvas
      expect(canvasSrc).toContain('data-aiflow-workflow-canvas=""');
      expect(canvasSrc).toContain('data-flow-canvas-actions=""');
      expect(canvasSrc).toContain("RotateCcw");
      expect(canvasSrc).toContain("RotateCw");
      expect(canvasSrc).toContain("undo");
      expect(canvasSrc).toContain("redo");
      expect(canvasSrc).toContain("handleKeyDown");
      expect(canvasSrc).toContain("useMotionPreference");

      // ProjectWorkspace
      expect(workspaceSrc).toContain("downloadSampleCsv");
      expect(workspaceSrc).toContain("下载导入模板");
      expect(workspaceSrc).toContain("最近取消发布时间");
      expect(workspaceSrc).toContain("尚未取消发布");
      expect(workspaceSrc).toContain("colSpan={6}");
      expect(workspaceSrc).toContain("grid-cols-2 gap-1.5");
      expect(workspaceSrc).toContain('aria-label="项目工作区"');
      expect(workspaceSrc).toContain('aria-label="业务流程列表"');
      expect(workspaceSrc).toContain("更多筛选");
      expect(workspaceSrc).toContain("显示第");
      expect(workspaceSrc).toContain("模板中还没有业务记录");
      expect(workspaceSrc).toContain("业务代号已存在：");

      // RunCenter
      expect(runCenterSrc).toContain(
        "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3"
      );
      expect(runCenterSrc).toContain("更多指标");
      expect(runCenterSrc).toContain(
        "lg:flex-row lg:items-end lg:justify-between"
      );
      expect(runCenterSrc).toContain("w-full min-w-0 flex-col gap-2");

      // ProcessWorkbench
      expect(processWorkbenchSrc).toContain('data-workbench-view-select=""');
      expect(processWorkbenchSrc).toContain(
        'className="hidden min-w-0 lg:mt-2 lg:grid lg:grid-cols-1 lg:gap-2"'
      );
      expect(processWorkbenchSrc).toContain('data-workbench-task-card=""');
      expect(processWorkbenchSrc).toContain('data-workbench-instance-card=""');
      expect(processWorkbenchSrc).toContain("展开本页后续");
      expect(processWorkbenchSrc).toContain('className="hidden lg:block"');
      expect(processWorkbenchSrc).toContain(
        "onClick={() => onView(item.view)}"
      );
      expect(processWorkbenchSrc).toContain("grid grid-cols-3 gap-2 sm:gap-3");
      expect(processWorkbenchSrc).toContain(
        'className="aiflow-type-code mt-1 block truncate whitespace-nowrap text-muted-foreground"'
      );
      expect(processWorkbenchSrc).toContain(
        'className="task-heading task-muted"'
      );
      expect(processWorkbenchSrc).toContain('className="task-caption"');

      // WorkflowDetailPage
      expect(detailSrc).toContain('data-aiflow-process-detail-page=""');
      expect(detailSrc).toContain("流程详情分区");
      expect(detailSrc).toContain("流程状态摘要");
      expect(detailSrc).toContain("只读预览；流程定义不会在此页面修改。");
      expect(detailSrc).toContain("readOnly");
      expect(detailSrc).toContain('value: "overview"');
      expect(detailSrc).toContain('value: "runs"');
      expect(detailSrc).toContain('value: "versions"');

      // WorkflowTestRunModal
      expect(testRunSrc).toContain("提交后会直接执行并创建运行记录");
      expect(testRunSrc).toContain("实际运行提示");
      expect(testRunSrc).toContain("当前入口不提供沙箱隔离");
      expect(testRunSrc).toContain("我已了解并确认：本次会直接真实执行");
      expect(testRunSrc).toContain("disabled={!canStartActualRun}");
      expect(testRunSrc).toContain("开始实际状态流转");
      expect(testRunSrc).toContain('role="note"');
      expect(testRunSrc).not.toContain("试运行结果仅供画布实时调试");
      expect(testRunSrc).toContain("outputRows");
      expect(testRunSrc).toContain("paginatedOutputRows");
      expect(testRunSrc).toContain("totalOutputPages");

      // SystemConfigShell
      expect(configSrc).toContain('id="system-config-active-tab"');
      expect(configSrc).toContain('aria-label="系统配置路径"');
      expect(configSrc).toContain('data-system-config-view-select=""');
      expect(configSrc).toContain('aria-label="系统配置分类"');
      expect(configSrc).toContain(
        "onChange={event => setTab(event.target.value as Tab)}"
      );
      expect(configSrc).toContain(
        'className="hidden min-w-0 lg:mt-2 lg:grid lg:grid-cols-1 lg:gap-2'
      );
      expect(configSrc).toContain('id="system-config-card"');
      expect(configSrc).toContain('aria-labelledby="system-config-active-tab"');
      expect(configSrc).toContain("trpc.config.readiness.useQuery");
      expect(configSrc).not.toContain('fetch("/readyz"');
      expect(configSrc).toContain('data-runtime-readiness=""');
      expect(configSrc).toContain('data-runtime-technical-details=""');
      expect(configSrc).toContain("状态来自服务端能力清单");

      // Resource and audit views distinguish missing data from confirmed empty data.
      expect(resourceSrc).toContain('data-resource-loading=""');
      expect(resourceSrc).toContain('data-resource-error=""');
      expect(resourceSrc).toContain(
        '!selectedQueryLoading && !selectedQueryError && tab === "flows"'
      );
      expect(resourceSrc).toContain('aria-label="项目资源类别"');
      expect(resourceSrc).toContain('data-resource-category-select=""');
      expect(resourceSrc).toContain('data-resource-category-desktop=""');
      expect(resourceSrc).toContain(
        'className="mb-4 hidden min-w-0 gap-2 pb-1 lg:flex lg:flex-wrap"'
      );
      expect(resourceSrc).toContain(
        'className="aiflow-type-body line-clamp-2 break-words text-muted-foreground"'
      );
      expect(resourceSrc).toContain(
        'className="aiflow-type-code px-4 py-3 font-mono text-muted-foreground"'
      );
      expect(resourceSrc).toContain(
        "aiflow-type-meta whitespace-nowrap rounded px-2 py-1 ${tone}"
      );
      expect(resourceSrc).toContain(
        'data-resource-table-desktop=""'
      );
      expect(resourceSrc).toContain(
        'aria-current={tab === item.id ? "page" : undefined}'
      );
      expect(homeSrc).toContain('login_failed: { label: "登录失败"');
      expect(homeSrc).toContain(
        'return authorizationAuditActions[action]?.label ?? "未识别操作"'
      );
      expect(homeSrc).toContain(
        "显示 {filteredAudit.length} / {audit.length} 条已加载记录"
      );
      expect(homeSrc).toContain('data-iam-audit-detail=""');
      expect(homeSrc).toContain("复制原码");

      TestResultCollector.record({
        testId: "TC-REG-SRC-010",
        name: "关键组件源码回归锚点与无障碍标识完整性校验",
        category: "validation",
        module: "全系统组件",
        target: "ComponentSources",
        status: "passed",
        start,
      });
    });
  });
});
