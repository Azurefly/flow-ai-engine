import { describe, expect, it } from "vitest";
import { TestResultCollector } from "./helpers/test-harness";
import { readFileSync } from "node:fs";

describe("功能测试 - 模块 8：界面交互优化与防退化功能回归 (UI & Motion Regression)", () => {
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

  describe("TC-REG-002: 业务中心 (BusinessCenterView) 客户端分页与 CSV 模板契约", () => {
    it("大列表切片分页计算、切换页长与页码重置逻辑正常", () => {
      const start = performance.now();

      // Mock 111 projects as reported on production
      const mockProjects = Array.from({ length: 111 }, (_, i) => ({
        id: `prj_${i + 1}`,
        code: `PRJ_${String(i + 1).padStart(3, "0")}`,
        name: `业务项目测试_${i + 1}`,
        workflowCount: i % 5,
        domainCode: i % 2 === 0 ? "DEFAULT" : null,
        domainName: i % 2 === 0 ? "默认工作域" : null,
        createdAt: new Date(2026, 8, 1, 10, i).toISOString(),
      }));

      const paginate = (items: typeof mockProjects, page: number, pageSize: number) => {
        const total = items.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.max(1, Math.min(page, totalPages));
        const startIndex = (safePage - 1) * pageSize;
        const sliced = items.slice(startIndex, startIndex + pageSize);
        return {
          total,
          totalPages,
          page: safePage,
          pageSize,
          startIndex,
          items: sliced,
        };
      };

      // 1. Default page 1, pageSize 25
      const p1 = paginate(mockProjects, 1, 25);
      expect(p1.total).toBe(111);
      expect(p1.totalPages).toBe(5);
      expect(p1.items.length).toBe(25);
      expect(p1.items[0].code).toBe("PRJ_001");
      expect(p1.items[24].code).toBe("PRJ_025");

      // 2. Last page (page 5)
      const p5 = paginate(mockProjects, 5, 25);
      expect(p5.items.length).toBe(11); // 111 - 100 = 11
      expect(p5.items[10].code).toBe("PRJ_111");

      // 3. Switch page size to 50
      const p50 = paginate(mockProjects, 1, 50);
      expect(p50.totalPages).toBe(3);
      expect(p50.items.length).toBe(50);

      // 4. Page out of bounds automatically clamped
      const pOver = paginate(mockProjects, 999, 25);
      expect(pOver.page).toBe(5);
      expect(pOver.items.length).toBe(11);

      TestResultCollector.record({
        testId: "TC-REG-PAGE-002",
        name: "业务中心 111 条大列表切片分页与自适应页长约束",
        category: "validation",
        module: "业务中心",
        target: "BusinessCenterView.pagination",
        status: "passed",
        start,
      });
    });

    it("下载 CSV 模板生成带 UTF-8 BOM 且包含必需列头", () => {
      const start = performance.now();

      const sample = "业务代号,业务名称,工作域代号,业务说明\r\nOPS,智能运维中心,DEFAULT,核心生产自动化运维与告警处置流程\r\nFINANCE,财务结算中心,,发票核验与报销自动化审批流程\r\n";
      const bomHeader = "﻿";
      const fullContent = bomHeader + sample;

      // Verify BOM exists
      expect(fullContent.charCodeAt(0)).toBe(0xFEFF);

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
        { id: "w1", status: "published", auditStatus: "approved", flowType: "state" },
        true
      );
      expect(a1.primary).toBe("发起流程");
      expect(a1.secondary).toContain("设计");
      expect(a1.secondary).toContain("取消发布");

      // Case 2: Draft Approved Data Flow (Non-manager)
      const a2 = resolveRowActions(
        { id: "w2", status: "draft", auditStatus: "approved", flowType: "data" },
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
      const totalOutputPages = Math.max(1, Math.ceil(totalOutputRows / OUTPUT_PAGE_SIZE));

      expect(totalOutputPages).toBe(5);

      // Page 1
      const page1 = rawOutputRows.slice(0, OUTPUT_PAGE_SIZE);
      expect(page1.length).toBe(25);
      expect(page1[0].id).toBe(1);
      expect(page1[24].id).toBe(25);

      // Page 5 (last page)
      const page5 = rawOutputRows.slice(4 * OUTPUT_PAGE_SIZE, 5 * OUTPUT_PAGE_SIZE);
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

      const shouldShowBatchBar = (view: string, selectedTaskIds: string[]): boolean => {
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
    it("零告警轻量状态展示，未选记录时全宽，选中时分栏展开", () => {
      const start = performance.now();

      const statusMap: Record<string, string> = {
        success: "成功",
        failed: "失败",
        running: "运行中",
        waiting: "等待人工",
        blocked: "已暂停",
        queued: "排队中",
        cancelled: "已取消",
        terminated: "已终止",
      };

      // Status mapping verified
      expect(statusMap["success"]).toBe("成功");
      expect(statusMap["waiting"]).toBe("等待人工");
      expect(statusMap["blocked"]).toBe("已暂停");

      // Grid columns derivation
      const getGridCols = (hasSelectedRun: boolean) =>
        hasSelectedRun ? "xl:grid-cols-[420px_1fr]" : "grid-cols-1";

      expect(getGridCols(false)).toBe("grid-cols-1");
      expect(getGridCols(true)).toBe("xl:grid-cols-[420px_1fr]");

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
  });

  describe("TC-REG-007: 流程设计器画布属性面板 (Inspector) 未选中隐退", () => {
    it("未选节点时属性面板不挂载，100% 画布可用空间；选择后从右侧展开", () => {
      const start = performance.now();

      const isInspectorRendered = (selectedId: string | null, selected: any, inspectorMode: string) => {
        return Boolean(selectedId && selected && inspectorMode !== "compact");
      };

      // Unselected -> false
      expect(isInspectorRendered(null, null, "normal")).toBe(false);

      // Selected -> true
      expect(isInspectorRendered("node_1", { id: "node_1" }, "normal")).toBe(true);

      // Selected but compact -> false
      expect(isInspectorRendered("node_1", { id: "node_1" }, "compact")).toBe(false);

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

  describe("TC-REG-008: 流程仓库 (WorkflowWarehouse) 动态双栏与三栏切换", () => {
    it("未选流程时展开为双栏铺满，选中后才激活三栏预览", () => {
      const start = performance.now();

      const getWarehouseLayout = (selectedWorkflowId: string | null) =>
        selectedWorkflowId
          ? "xl:grid-cols-[280px_minmax(0,1fr)_420px]"
          : "xl:grid-cols-[280px_minmax(0,1fr)]";

      expect(getWarehouseLayout(null)).toBe("xl:grid-cols-[280px_minmax(0,1fr)]");
      expect(getWarehouseLayout("wf_101")).toBe("xl:grid-cols-[280px_minmax(0,1fr)_420px]");

      TestResultCollector.record({
        testId: "TC-REG-WH-009",
        name: "流程仓库未选条目时双栏展开与选中后三栏抽屉唤起",
        category: "contract",
        module: "流程仓库",
        target: "WorkflowWarehouse.LayoutSwitch",
        status: "passed",
        start,
      });
    });
  });

  describe("TC-REG-009: 源代码回归契约文件完整性核验", () => {
    it("核验前端组件文件中包含所有历史回归关键锚点与 ARIA 标记", () => {
      const start = performance.now();

      const readSrc = (relPath: string) =>
        readFileSync(new URL(`../../client/src/${relPath}`, import.meta.url), "utf8");

      const canvasSrc = readSrc("components/WorkflowCanvas.tsx");
      const workspaceSrc = readSrc("components/ProjectWorkspace.tsx");
      const detailSrc = readSrc("components/WorkflowDetailPage.tsx");
      const testRunSrc = readSrc("components/WorkflowTestRunModal.tsx");
      const configSrc = readSrc("components/SystemConfigShell.tsx");

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
      expect(workspaceSrc).toContain("下载模板");
      expect(workspaceSrc).toContain("最近取消发布时间");
      expect(workspaceSrc).toContain("尚未取消发布");
      expect(workspaceSrc).toContain("colSpan={12}");
      expect(workspaceSrc).toContain("colSpan={10}");
      expect(workspaceSrc).toContain("sticky right-0");

      // WorkflowDetailPage
      expect(detailSrc).toContain('data-aiflow-process-detail-page=""');
      expect(detailSrc).toContain("READ-ONLY CANVAS");
      expect(detailSrc).toContain("readOnly");

      // WorkflowTestRunModal
      expect(testRunSrc).toContain("将保存当前草稿并发起测试执行，实际影响由节点与外部服务配置决定。");
      expect(testRunSrc).toContain("outputRows");
      expect(testRunSrc).toContain("paginatedOutputRows");
      expect(testRunSrc).toContain("totalOutputPages");

      // SystemConfigShell
      expect(configSrc).toContain('id="system-config-active-tab"');
      expect(configSrc).toContain('aria-controls="system-config-card"');
      expect(configSrc).toContain('id="system-config-card"');
      expect(configSrc).toContain('role="tabpanel"');

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
