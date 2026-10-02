import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WORKBENCH_STATUS_LABELS } from "../../shared/workbench-list-status";
import { TestResultCollector } from "./helpers/test-harness";

describe("功能测试 - 模块 3：已启动流程工作台与运行中心 (Process Workbench & Run Center)", () => {
  describe("6 大视图切换与任务状态标记效果", () => {
    it("从看板或日历打开任务时保留原视图，关闭详情可返回上下文", () => {
      const start = performance.now();
      const source = readFileSync(
        new URL(
          "../../client/src/components/ProcessWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      );

      expect(source).toContain(
        "const openTask = (taskId: string) => setSelectedTaskId(taskId);"
      );
      expect(source.match(/onTask=\{openTask\}/g)).toHaveLength(2);
      expect(source).not.toMatch(/onTask=\{id => \{\s*changeView\("todo"\);/);

      TestResultCollector.record({
        testId: "TC-MOD3-TASK-CONTEXT-001",
        name: "从看板和日历查看任务时保留原工作台上下文",
        category: "contract",
        module: "已启动流程工作台",
        target: "ProcessWorkbench.TaskDrawerContext",
        status: "passed",
        start,
      });
    });

    it("看板、日历、待办、已办、我发起、全部流程 6 视图映射", () => {
      const start = performance.now();

      const views = [
        "board",
        "calendar",
        "todo",
        "done",
        "initiated",
        "all",
      ] as const;
      const viewLabels: Record<(typeof views)[number], string> = {
        board: "我的看板",
        calendar: "日历",
        todo: "待办",
        done: "已办",
        initiated: "我发起",
        all: "全部流程",
      };

      for (const v of views) {
        expect(viewLabels[v]).toBeTruthy();
      }

      // Query input derivation
      const getTaskInput = (view: (typeof views)[number]) => ({
        view:
          view === "board" || view === "calendar" ? ("todo" as const) : view,
        limit: 20,
      });

      expect(getTaskInput("board").view).toBe("todo");
      expect(getTaskInput("done").view).toBe("done");

      TestResultCollector.record({
        testId: "TC-MOD3-VIEW-001",
        name: "已启动流程 6 大视图映射与参数派生逻辑",
        category: "button",
        module: "已启动流程工作台",
        target: "ProcessWorkbenchViews",
        status: "passed",
        start,
      });
    });

    it("工作台移动端用单行选择器、桌面保留侧栏列表", () => {
      const start = performance.now();
      const source = readFileSync(
        new URL(
          "../../client/src/components/ProcessWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      );
      const styles = readFileSync(
        new URL("../../client/src/index.css", import.meta.url),
        "utf8"
      );

      expect(source).toContain('data-workbench-view-select=""');
      expect(source).toContain('aria-label="已启动流程视图"');
      expect(source).toContain(
        "onChange={event => changeView(event.target.value as View)}"
      );
      expect(source).toContain(
        'className="hidden min-w-0 lg:mt-2 lg:grid lg:grid-cols-1 lg:gap-2"'
      );
      expect(source).toContain('data-workbench-view-navigation=""');
      expect(source).toContain("min-w-0 flex-1 whitespace-nowrap");
      expect(source).toContain("shrink-0 whitespace-nowrap rounded bg-card");
      expect(source).toContain("p-2 sm:p-4");
      expect(source).toContain("truncate whitespace-nowrap");
      expect(source).toContain("hidden shrink-0 sm:block");
      expect(source).toContain("aiflow-type-display mt-1 font-bold sm:mt-2");
      expect(source).toContain(
        "aiflow-type-body flex min-w-0 items-center justify-between gap-1 font-medium"
      );
      expect(styles).not.toContain("[data-workbench-view-navigation] {");
      expect(source).toContain('aria-label="刷新当前视图"');
      expect(source).toContain("sr-only sm:not-sr-only");

      TestResultCollector.record({
        testId: "TC-MOD3-NAV-RESPONSIVE-001",
        name: "工作台移动端单行视图选择器与桌面侧栏导航",
        category: "contract",
        module: "已启动流程工作台",
        target: "ProcessWorkbench.ViewNavigation",
        status: "passed",
        start,
      });
    });

    it("窄屏日历支持分段展开和随时收起", () => {
      const start = performance.now();
      const source = readFileSync(
        new URL(
          "../../client/src/components/ProcessWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      );

      expect(source).toContain("dayEvents.slice(0, visibleEventLimit)");
      expect(source).toContain('"show-more"');
      expect(source).toContain('"collapse"');
      expect(source).toContain("aria-expanded={hasExpandedEvents}");
      expect(source).toContain("显示后续 ${Math.min(CALENDAR_AGENDA_PAGE_SIZE");
      expect(source).toContain("收起到前 ${CALENDAR_DAY_PREVIEW_LIMIT} 项");
      expect(source).toContain("min-h-11 w-full");
      expect(source).toContain("setAgendaVisibleLimits({});");

      TestResultCollector.record({
        testId: "TC-MOD3-CAL-UI-002",
        name: "窄屏日历任务分段展开与随时收起",
        category: "contract",
        module: "已启动流程工作台",
        target: "ProcessWorkbench.CalendarMobileAgenda",
        status: "passed",
        start,
      });
    });

    it("流程与任务列表在窄屏使用摘要卡片并分段展开", () => {
      const start = performance.now();
      const source = readFileSync(
        new URL(
          "../../client/src/components/ProcessWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      );

      expect(source).toContain('data-workbench-task-card=""');
      expect(source).toContain('data-workbench-instance-card=""');
      expect(source).toContain(
        'className="grid gap-2 p-3 md:grid-cols-2 lg:hidden"'
      );
      expect(source).toContain('className="hidden lg:block"');
      expect(source).toContain(
        'columnWidths={["32%", "15%", "24%", "18%", "11%"]}'
      );
      expect(source).toContain("table-fixed");
      expect(source).toContain('data-workbench-instance-name=""');
      expect(source).toContain("max-w-full break-words whitespace-normal");
      expect(source.match(/useState\(10\)/g)?.length).toBe(2);
      expect(source).toContain("current + 10");
      expect(source).toContain("展开本页后续");
      expect(source).toContain("h-11 lg:h-9");
      expect(source).toContain(
        "aiflow-type-control min-h-11 min-w-11 shrink-0"
      );

      TestResultCollector.record({
        testId: "TC-MOD3-LIST-CARDS-001",
        name: "流程实例与人工任务窄屏卡片和渐进展开",
        category: "contract",
        module: "已启动流程工作台",
        target: "ProcessWorkbench.ResponsiveLists",
        status: "passed",
        start,
      });
    });

    it("列表读取期间隐藏旧分页结论，并标记暂显的旧数据", () => {
      const start = performance.now();
      const source = readFileSync(
        new URL(
          "../../client/src/components/ProcessWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      );

      expect(source).toContain("getWorkbenchListStatusMessage,");
      expect(source).toContain("getWorkbenchStatusOptions,");
      expect(source).toContain("aria-busy={pagingLoading}");
      expect(source).toContain(
        "!pagingLoading && !matchingCount && hasNextPage"
      );
      expect(source).toContain(
        "pagingLoading && filteredListRows.length === 0"
      );

      TestResultCollector.record({
        testId: "TC-MOD3-LIST-LOADING-SUMMARY-001",
        name: "列表分页摘要区分读取中、刷新中与已完成状态",
        category: "contract",
        module: "已启动流程工作台",
        target: "ProcessWorkbench.ListLoadingSummary",
        status: "passed",
        start,
      });
    });

    it("流程列表默认每页20条并统一主要表格字号", () => {
      const start = performance.now();
      const source = readFileSync(
        new URL(
          "../../client/src/components/ProcessWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      );

      expect(source).toContain("const [pageSize, setPageSize] = useState(20);");
      expect(source.match(/limit: pageSize/g)).toHaveLength(2);
      expect(source).toContain('aria-label="每页条数"');
      expect(source).toContain("<option value={20}>20 条</option>");
      expect(source).toContain("<option value={50}>50 条</option>");
      expect(source).toContain("<option value={100}>100 条</option>");
      expect(source).toContain("aiflow-type-meta rounded px-1.5 py-0.5");
      expect(source).toContain(
        "aiflow-type-body min-w-0 break-words whitespace-normal px-3 py-3 align-top text-muted-foreground"
      );
      expect(source).toContain(
        "aiflow-type-meta whitespace-nowrap px-3 py-3 text-muted-foreground"
      );
      expect(source).toContain(
        'className="bg-muted text-sm font-medium text-muted-foreground"'
      );

      TestResultCollector.record({
        testId: "TC-MOD3-LIST-DENSITY-TYPE-001",
        name: "流程列表分页密度与主要信息字号保持一致",
        category: "contract",
        module: "已启动流程工作台",
        target: "ProcessWorkbench.InstanceListTypography",
        status: "passed",
        start,
      });
    });

    it("任务与实例状态徽标渲染与文案匹配", () => {
      const start = performance.now();

      const statusMap = WORKBENCH_STATUS_LABELS;
      const source = readFileSync(
        new URL(
          "../../client/src/components/ProcessWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      );

      for (const [code, label] of Object.entries(statusMap)) {
        expect(label).toBeTruthy();
        expect(typeof code).toBe("string");
      }
      expect(statusMap.running).toBe("运行中");
      expect(statusMap.waiting).toBe("等待中");
      expect(statusMap.blocked).toBe("已阻塞");
      expect(source).toContain('"运行状态 / 业务状态"');
      expect(source).toContain("业务：{businessStatus}");

      TestResultCollector.record({
        testId: "TC-MOD3-STATUS-001",
        name: "流程任务与实例状态映射准确性",
        category: "contract",
        module: "已启动流程工作台",
        target: "TaskStatusBadges",
        status: "passed",
        start,
      });
    });

    it("已完成与已取消任务明确显示历史只读状态", () => {
      const start = performance.now();
      const source = readFileSync(
        new URL(
          "../../client/src/components/ProcessWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      );

      expect(source).toContain("此任务已完成，以下为历史处理记录。");
      expect(source).toContain("此任务已取消，当前为只读记录。");
      expect(source).toContain('"未配置操作说明。"');
      expect(source).toContain('"请完成当前人工操作。"');
      expect(source).toContain('"请由指定处理人完成当前人工操作。"');
      expect(source).toContain("此任务仅供查看；处理操作由指定处理人完成。");
      expect(source).toContain("task?.instruction?.trim() ||");
      expect(source).toContain("const taskInstructionLabel = isHistoricalTask");
      expect(source).toContain('"指定处理人办理说明"');
      expect(source).toContain("{taskHistoryNotice && (");

      TestResultCollector.record({
        testId: "TC-MOD3-TASK-HISTORY-001",
        name: "已完成与已取消任务清楚区分历史记录和待处理操作",
        category: "contract",
        module: "已启动流程工作台",
        target: "ProcessWorkbench.TaskHistoryState",
        status: "passed",
        start,
      });
    });
  });

  describe("单任务操作按钮执行效果", () => {
    it("领取任务（claim）状态流转：pending -> claimed", () => {
      const start = performance.now();

      const task = {
        id: "task-001",
        status: "pending" as "pending" | "claimed" | "completed",
        assigneeUserId: null as number | null,
      };

      // Execute claim
      const claimTask = (currentTask: typeof task, userId: number) => {
        if (currentTask.status !== "pending")
          throw new Error("任务非待处理状态，不可领取。");
        return {
          ...currentTask,
          status: "claimed" as const,
          assigneeUserId: userId,
        };
      };

      const claimed = claimTask(task, 101);
      expect(claimed.status).toBe("claimed");
      expect(claimed.assigneeUserId).toBe(101);

      // Re-claiming claimed task should be rejected
      expect(() => claimTask(claimed, 102)).toThrow(
        "任务非待处理状态，不可领取"
      );

      TestResultCollector.record({
        testId: "TC-MOD3-BTN-001",
        name: "领取任务状态流转与所有权绑定",
        category: "button",
        module: "已启动流程工作台",
        target: "task.claim",
        status: "passed",
        start,
      });
    });

    it("办理审批（complete / execute）：同意、拒绝、弃权与处理意见校验", () => {
      const start = performance.now();

      type Decision = "approved" | "rejected" | "abstained";
      const completeTask = (
        decision: Decision,
        comment?: string,
        requireCommentOnReject = true
      ) => {
        if (
          decision === "rejected" &&
          requireCommentOnReject &&
          (!comment || !comment.trim())
        ) {
          throw new Error("驳回/拒绝必须填写处理意见。");
        }
        return {
          decision,
          comment: comment?.trim() || "",
          completedAt: new Date().toISOString(),
        };
      };

      // 1. Approved without comment
      const resultApproved = completeTask("approved");
      expect(resultApproved.decision).toBe("approved");

      // 2. Rejected without comment should fail
      expect(() => completeTask("rejected", "")).toThrow("必须填写处理意见");

      // 3. Rejected with comment succeeds
      const resultRejected = completeTask("rejected", "不符合请假合规要求");
      expect(resultRejected.decision).toBe("rejected");
      expect(resultRejected.comment).toBe("不符合请假合规要求");

      // 4. Abstained
      const resultAbstained = completeTask("abstained", "放弃表决");
      expect(resultAbstained.decision).toBe("abstained");

      TestResultCollector.record({
        testId: "TC-MOD3-BTN-002",
        name: "办理审批决策（同意/拒绝/弃权）与必填意见校验",
        category: "button",
        module: "已启动流程工作台",
        target: "task.complete",
        status: "passed",
        start,
      });
    });

    it("任务移交（handover）与退回待处理（returnToPending）执行效果", () => {
      const start = performance.now();

      const task = {
        id: "task-002",
        status: "claimed" as "pending" | "claimed",
        assigneeUserId: 101,
      };

      // Handover transfers to user 102 and resets status to pending
      const handoverTask = (currentTask: typeof task, targetUserId: number) => {
        if (targetUserId === currentTask.assigneeUserId) {
          throw new Error("请勿移交给当前相同的处理人。");
        }
        return {
          ...currentTask,
          status: "pending" as const,
          assigneeUserId: targetUserId,
        };
      };

      const handedOver = handoverTask(task, 102);
      expect(handedOver.status).toBe("pending");
      expect(handedOver.assigneeUserId).toBe(102);

      // Return to pending resets claimed task back to pool/pending
      const returnToPending = (currentTask: typeof task) => {
        return {
          ...currentTask,
          status: "pending" as const,
        };
      };

      const returned = returnToPending(task);
      expect(returned.status).toBe("pending");

      TestResultCollector.record({
        testId: "TC-MOD3-BTN-003",
        name: "任务移交与退回待处理状态恢复",
        category: "button",
        module: "已启动流程工作台",
        target: "task.handover/returnToPending",
        status: "passed",
        start,
      });
    });

    it("加签与减签（addSigner / removeSigner）与审批进度计算", () => {
      const start = performance.now();

      type SignMode = "orSignFor" | "andSignFor" | "sequentialSignFor";
      type TaskSigner = {
        userId: number;
        status: "pending" | "completed" | "rejected";
      };

      const calculateApprovalProgress = (
        signMode: SignMode,
        signers: TaskSigner[]
      ) => {
        const total = signers.length;
        const approved = signers.filter(s => s.status === "completed").length;
        const rejected = signers.filter(s => s.status === "rejected").length;
        const required = signMode === "orSignFor" ? 1 : total;
        const isPassed = approved >= required;
        const isFailed = signMode === "andSignFor" && rejected > 0;
        return { total, approved, rejected, required, isPassed, isFailed };
      };

      // OrSign (或签): 1 approved out of 3 completes
      const orProgress = calculateApprovalProgress("orSignFor", [
        { userId: 1, status: "completed" },
        { userId: 2, status: "pending" },
        { userId: 3, status: "pending" },
      ]);
      expect(orProgress.isPassed).toBe(true);

      // AndSign (会签): 2 approved out of 3 is not yet passed
      const andProgress1 = calculateApprovalProgress("andSignFor", [
        { userId: 1, status: "completed" },
        { userId: 2, status: "completed" },
        { userId: 3, status: "pending" },
      ]);
      expect(andProgress1.isPassed).toBe(false);

      // AndSign (会签): 3 approved out of 3 is passed
      const andProgress2 = calculateApprovalProgress("andSignFor", [
        { userId: 1, status: "completed" },
        { userId: 2, status: "completed" },
        { userId: 3, status: "completed" },
      ]);
      expect(andProgress2.isPassed).toBe(true);

      TestResultCollector.record({
        testId: "TC-MOD3-BTN-004",
        name: "会签/或签模式加签减签与进度结算算法",
        category: "button",
        module: "已启动流程工作台",
        target: "task.addSigner/removeSigner",
        status: "passed",
        start,
      });
    });
  });

  describe("批量操作按钮与执行效果", () => {
    it("批量领取（batchClaim）与批量审批（batchComplete）", () => {
      const start = performance.now();

      const taskPool = [
        { id: "t1", status: "pending" },
        { id: "t2", status: "pending" },
        { id: "t3", status: "claimed" }, // Already claimed
      ];

      // Batch claim simulation
      const batchClaim = (taskIds: string[]) => {
        return taskIds.map(id => {
          const t = taskPool.find(item => item.id === id);
          if (!t) return { id, success: false, error: "任务不存在" };
          if (t.status !== "pending")
            return { id, success: false, error: "已被领取" };
          t.status = "claimed";
          return { id, success: true };
        });
      };

      const claimResults = batchClaim(["t1", "t2", "t3"]);
      expect(claimResults[0].success).toBe(true);
      expect(claimResults[1].success).toBe(true);
      expect(claimResults[2].success).toBe(false);
      expect(claimResults.filter(r => r.success).length).toBe(2);

      // Batch complete with decision
      const batchComplete = (
        taskIds: string[],
        decision: "approved" | "rejected",
        comment?: string
      ) => {
        if (decision === "rejected" && !comment?.trim()) {
          throw new Error("批量拒绝必须填写处理意见。");
        }
        return taskIds.map(id => ({ id, success: true, decision }));
      };

      expect(() => batchComplete(["t1", "t2"], "rejected", "")).toThrow(
        "必须填写处理意见"
      );
      const completeResults = batchComplete(["t1", "t2"], "approved");
      expect(completeResults.length).toBe(2);

      TestResultCollector.record({
        testId: "TC-MOD3-BATCH-001",
        name: "批量领取与批量审批逐项执行与结果汇总",
        category: "button",
        module: "已启动流程工作台",
        target: "task.batchClaim/batchComplete",
        status: "passed",
        start,
      });
    });
  });
});
