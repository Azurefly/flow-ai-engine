import { Button } from "@/components/ui/button";
import { taskFormInputValue } from "@shared/task-form";
import { canManageTask } from "@shared/task-assignment";
import { TaskFormField } from "./TaskFormField";
import { Input } from "@/components/ui/input";
import { ProcessWorkbenchRunTab } from "@/components/ProcessWorkbenchRunTab";
import { trpc } from "@/lib/trpc";
import {
  CALENDAR_AGENDA_PAGE_SIZE,
  CALENDAR_DAY_PREVIEW_LIMIT,
  getCalendarAgendaVisibleLimit,
} from "@shared/calendar-agenda";
import {
  getWorkbenchListStatusMessage,
  getWorkbenchStatusOptions,
  WORKBENCH_STATUS_LABELS,
} from "@shared/workbench-list-status";
import {
  AlertTriangle,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Send,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type View = "board" | "calendar" | "todo" | "done" | "initiated" | "all";
const labels: Record<View, string> = {
  board: "我的看板",
  calendar: "日历",
  todo: "待办",
  done: "已办",
  initiated: "我发起",
  all: "全部流程",
};

function formatStatusLabel(status: string) {
  return WORKBENCH_STATUS_LABELS[status] ?? status;
}

function date(value: unknown) {
  return value
    ? new Date(String(value)).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function badge(status: string) {
  const styles: Record<string, string> = {
    pending: "bg-aiflow-warning-surface text-aiflow-warning",
    claimed: "bg-aiflow-info-surface text-aiflow-info",
    completed: "bg-aiflow-success-surface text-aiflow-success",
    success: "bg-aiflow-success-surface text-aiflow-success",
    failed: "bg-red-100 text-red-700",
    running: "bg-aiflow-info-surface text-aiflow-info",
    等待审核: "bg-aiflow-warning-surface text-aiflow-warning",
    待审批: "bg-aiflow-warning-surface text-aiflow-warning",
    已审核: "bg-aiflow-info-surface text-aiflow-info",
    "直接上级审核通过，待经理通过": "bg-indigo-100 text-indigo-700",
    申请通过: "bg-aiflow-success-surface text-aiflow-success",
  };
  return (
    <span
      className={`aiflow-type-meta rounded px-1.5 py-0.5 font-semibold ${styles[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {formatStatusLabel(status)}
    </span>
  );
}

function approvalLabel(task: any) {
  if (task?.signMode === "orSignFor") return "或签";
  if (task?.signMode === "andSignFor") return "会签";
  if (task?.signMode === "sequentialSignFor") return "顺序会签";
  return "";
}

function approvalProgressText(task: any) {
  const progress = task?.approvalProgress;
  if (!progress) return "";
  const rejected = Number(progress.rejected || 0);
  return `${approvalLabel(task)}通过 ${Number(progress.approved ?? progress.completed ?? 0)}/${Number(progress.required || 1)}（共 ${Number(progress.total || 1)} 人）${rejected ? ` · 拒绝 ${rejected}` : ""}`;
}

export default function ProcessWorkbench() {
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>("board");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [pageCursorStack, setPageCursorStack] = useState<
    Array<string | undefined>
  >([undefined]);
  const [batchDecision, setBatchDecision] = useState<
    "approved" | "rejected" | "abstained"
  >("approved");
  const [batchComment, setBatchComment] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [debouncedListSearch, setDebouncedListSearch] = useState("");
  const [listStatus, setListStatus] = useState("all");
  const [listFrom, setListFrom] = useState("");
  const [listThrough, setListThrough] = useState("");
  const [month, setMonth] = useState(() => new Date());
  const [calendarCursorStack, setCalendarCursorStack] = useState<
    Array<string | undefined>
  >([undefined]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarNextCursor, setCalendarNextCursor] = useState<string | null>(
    null
  );
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedListSearch(listSearch);
      setPageCursorStack([undefined]);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [listSearch]);
  const dashboard = trpc.task.dashboard.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const currentPageCursor = pageCursorStack[pageCursorStack.length - 1];
  const dateFilterInput = useMemo(
    () => ({
      ...(listFrom ? { createdAtFrom: new Date(`${listFrom}T00:00:00`) } : {}),
      ...(listThrough
        ? {
            createdAtBefore: new Date(
              new Date(`${listThrough}T00:00:00`).getTime() + 86_400_000
            ),
          }
        : {}),
    }),
    [listFrom, listThrough]
  );
  const taskInput = useMemo(
    () => ({
      view: view === "board" || view === "calendar" ? ("todo" as const) : view,
      limit: pageSize,
      cursor: currentPageCursor,
      ...(debouncedListSearch.trim()
        ? { search: debouncedListSearch.trim() }
        : {}),
      ...(listStatus !== "all" ? { status: listStatus } : {}),
      ...dateFilterInput,
    }),
    [
      view,
      currentPageCursor,
      pageSize,
      debouncedListSearch,
      listStatus,
      dateFilterInput,
    ]
  );
  const tasks = trpc.task.page.useQuery(taskInput, {
    enabled: ["todo", "done"].includes(view),
    refetchInterval: 30_000,
  });
  const instanceInput = useMemo(
    () => ({
      view: view === "initiated" ? ("initiated" as const) : ("all" as const),
      limit: pageSize,
      cursor: currentPageCursor,
      ...(debouncedListSearch.trim()
        ? { search: debouncedListSearch.trim() }
        : {}),
      ...(listStatus !== "all" ? { status: listStatus } : {}),
      ...dateFilterInput,
    }),
    [
      view,
      currentPageCursor,
      pageSize,
      debouncedListSearch,
      listStatus,
      dateFilterInput,
    ]
  );
  const calendarInput = useMemo(
    () => ({
      start: new Date(month.getFullYear(), month.getMonth(), 1),
      end: new Date(month.getFullYear(), month.getMonth() + 1, 1),
      limit: 200,
      cursor: calendarCursorStack[calendarCursorStack.length - 1],
    }),
    [month.getFullYear(), month.getMonth(), calendarCursorStack]
  );
  const instances = trpc.task.instancePage.useQuery(instanceInput, {
    enabled: ["initiated", "all"].includes(view),
    refetchInterval: 30_000,
  });
  const taskPage = tasks.data;
  const instancePage = instances.data;
  const taskRows = (taskPage?.items ?? []) as any[];
  const instanceRows = (instancePage?.items ?? []) as any[];
  const listRows = ["todo", "done"].includes(view) ? taskRows : instanceRows;
  const filteredListRows = listRows;
  const listStatusOptions = useMemo(
    () =>
      getWorkbenchStatusOptions(
        listRows,
        listStatus,
        !["todo", "done"].includes(view)
      ),
    [listRows, listStatus, view]
  );
  const hasListFilters =
    Boolean(listSearch.trim()) ||
    listStatus !== "all" ||
    Boolean(listFrom) ||
    Boolean(listThrough);
  const activeHasNextPage = ["todo", "done"].includes(view)
    ? Boolean(taskPage?.hasMore)
    : Boolean(instancePage?.hasMore);
  const searchPending = listSearch !== debouncedListSearch;
  const pagingLoading =
    tasks.isFetching || instances.isFetching || searchPending;
  const calendar = trpc.task.calendar.useQuery(calendarInput, {
    enabled: view === "calendar",
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (calendar.isFetching || !calendar.data) return;
    setCalendarEvents(current => {
      const seen = new Set(current.map(event => event.id));
      return [
        ...current,
        ...calendar.data.items.filter(event => !seen.has(event.id)),
      ];
    });
    setCalendarNextCursor(calendar.data.nextCursor);
  }, [calendar.data, calendar.isFetching]);
  const taskDetail = trpc.task.get.useQuery(
    { taskId: selectedTaskId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(selectedTaskId), retry: false }
  );
  const assignees = trpc.task.assignees.useQuery(
    { taskId: selectedTaskId ?? "00000000-0000-0000-0000-000000000000" },
    {
      enabled: Boolean(
        selectedTaskId &&
          (taskDetail.data as { id?: string } | undefined)?.id ===
            selectedTaskId &&
          canManageTask(taskDetail.data)
      ),
      retry: false,
    }
  );
  const invalidate = (refreshAssignees = true) => {
    void utils.task.dashboard.invalidate();
    void utils.task.list.invalidate();
    void utils.task.page.invalidate();
    void utils.task.instances.invalidate();
    void utils.task.instancePage.invalidate();
    void utils.task.calendar.invalidate();
    if (selectedTaskId) {
      void utils.task.get.invalidate({ taskId: selectedTaskId });
      if (refreshAssignees)
        void utils.task.assignees.invalidate({ taskId: selectedTaskId });
    }
  };
  const claim = trpc.task.claim.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("人工任务已领取。");
    },
    onError: error => toast.error(error.message),
  });
  const complete = trpc.task.complete.useMutation({
    onSuccess: result => {
      setSelectedTaskId(null);
      invalidate(false);
      if (result.status === "cancelled")
        toast.warning("审批已拒绝，流程已按安全策略终止。");
      else
        toast.success(
          result.status === "waiting"
            ? "当前决定已记录，流程正在等待其他审批人。"
            : result.status === "queued"
              ? "审批已通过，后续节点已进入持久化续跑队列。"
              : "审批已通过，流程已由服务端继续执行。"
        );
      setSelectedRunId(result.runId);
    },
    onError: error => toast.error(error.message),
  });
  const execute = trpc.task.execute.useMutation({
    onSuccess: result => {
      invalidate(false);
      if (result.status === "cancelled")
        toast.warning("审批已拒绝，流程已按安全策略终止。");
      else
        toast.success(
          result.status === "waiting"
            ? "当前决定已记录，流程正在等待其他审批人。"
            : result.status === "queued"
              ? "审批已通过，后续节点已进入持久化续跑队列。"
              : "审批已通过，流程已完成。"
        );
      if (result.runId) setSelectedRunId(result.runId);
      setSelectedTaskId(null);
    },
    onError: error => toast.error(error.message),
  });
  const handover = trpc.task.handover.useMutation({
    onSuccess: () => {
      setSelectedTaskId(null);
      invalidate(false);
      toast.success("人工任务已移交，已恢复为指定处理人的待办。");
    },
    onError: error => toast.error(error.message),
  });
  const delegate = trpc.task.delegate.useMutation({
    onSuccess: () => {
      setSelectedTaskId(null);
      invalidate(false);
      toast.success("任务已代理给指定处理人，已保留被代理主体审计。");
    },
    onError: error => toast.error(error.message),
  });
  const addSigner = trpc.task.addSigner.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("已加入新的审批人。");
    },
    onError: error => toast.error(error.message),
  });
  const removeSigner = trpc.task.removeSigner.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("已移除未处理的审批人。");
    },
    onError: error => toast.error(error.message),
  });
  const returnToPending = trpc.task.returnToPending.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("任务已退回待处理，流程仍保持等待状态。");
    },
    onError: error => toast.error(error.message),
  });
  const batchClaim = trpc.task.batchClaim.useMutation({
    onSuccess: results => {
      invalidate();
      setSelectedTaskIds([]);
      const success = results.filter(item => item.success).length;
      const failed = results.length - success;
      toast.success(
        `批量领取完成：${success} 项成功${failed ? `，${failed} 项未处理` : ""}。`
      );
    },
    onError: error => toast.error(error.message),
  });
  const batchComplete = trpc.task.batchComplete.useMutation({
    onSuccess: results => {
      invalidate(false);
      setSelectedTaskIds([]);
      const success = results.filter(item => item.success).length;
      const failed = results.length - success;
      const completed = results.find(
        item =>
          item.success && ["success", "cancelled"].includes(String(item.status))
      );
      if (completed?.runId) setSelectedRunId(completed.runId);
      const message = `批量处理已逐项执行：${success} 项成功${failed ? `，${failed} 项未处理` : ""}。`;
      if (!success) toast.error(message);
      else if (failed) toast.warning(message);
      else toast.success(message);
    },
    onError: error => toast.error(error.message),
  });
  const busy =
    claim.isPending ||
    complete.isPending ||
    execute.isPending ||
    handover.isPending ||
    delegate.isPending ||
    addSigner.isPending ||
    removeSigner.isPending ||
    returnToPending.isPending ||
    batchClaim.isPending ||
    batchComplete.isPending;
  const nav = [
    { id: "board" as const, icon: LayoutDashboard, count: null },
    { id: "calendar" as const, icon: CalendarDays, count: null },
    { id: "todo" as const, icon: ListTodo, count: dashboard.data?.counts.todo },
    {
      id: "done" as const,
      icon: CheckCheck,
      count: dashboard.data?.counts.done,
    },
    {
      id: "initiated" as const,
      icon: Send,
      count: dashboard.data?.counts.initiated,
    },
    {
      id: "all" as const,
      icon: ClipboardList,
      count: dashboard.data?.counts.all,
    },
  ];
  const closeRunTab = () => {
    setSelectedRunId(null);
    invalidate();
  };
  const changeView = (next: View) => {
    setView(next);
    setSelectedRunId(null);
    setSelectedTaskId(null);
    setSelectedTaskIds([]);
    setPageCursorStack([undefined]);
    setListSearch("");
    setDebouncedListSearch("");
    setListStatus("all");
    setListFrom("");
    setListThrough("");
    invalidate();
  };
  const openTask = (taskId: string) => setSelectedTaskId(taskId);
  const changeCalendarMonth = (nextMonth: Date) => {
    if (
      nextMonth.getFullYear() === month.getFullYear() &&
      nextMonth.getMonth() === month.getMonth()
    ) {
      setMonth(nextMonth);
      return;
    }
    setCalendarCursorStack([undefined]);
    setCalendarEvents([]);
    setCalendarNextCursor(null);
    setMonth(nextMonth);
  };
  const loadMoreCalendarEvents = () => {
    if (calendar.isError) {
      void calendar.refetch();
      return;
    }
    if (calendarNextCursor && !calendar.isFetching)
      setCalendarCursorStack(current => [...current, calendarNextCursor]);
  };
  const runBatchComplete = () => {
    if (batchDecision === "rejected" && !batchComment.trim()) {
      toast.error("批量拒绝必须填写处理意见。");
      return;
    }
    batchComplete.mutate({
      taskIds: selectedTaskIds,
      result: {
        decision: batchDecision,
        ...(batchComment.trim() ? { comment: batchComment.trim() } : {}),
      },
    });
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-background p-4 sm:p-6">
      <div
        data-workbench-layout=""
        className={`grid gap-4 ${sidebarCollapsed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[230px_minmax(0,1fr)]"}`}
      >
        <aside
          data-workbench-navigation=""
          className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-2 shadow-sm"
        >
          <div
            data-workbench-nav-header=""
            className={`hidden border-b border-border px-3 py-3 lg:flex ${sidebarCollapsed ? "justify-center" : ""}`}
          >
            <div className={sidebarCollapsed ? "hidden" : ""}>
              <p className="aiflow-type-meta font-bold tracking-[.16em] text-muted-foreground">
                INITIATED PROCESS
              </p>
              <h2 className="aiflow-type-section-title mt-1 font-semibold text-foreground">
                已启动流程
              </h2>
            </div>
            <button
              type="button"
              aria-label={
                sidebarCollapsed ? "展开已启动流程导航" : "收起已启动流程导航"
              }
              title={sidebarCollapsed ? "展开导航" : "收起导航"}
              className={`min-h-11 min-w-11 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground ${sidebarCollapsed ? "" : "ml-auto"}`}
              onClick={() => setSidebarCollapsed(value => !value)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
          </div>
          <label className="mt-2 grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 lg:hidden">
            <span className="aiflow-type-control whitespace-nowrap font-medium text-muted-foreground">
              视图
            </span>
            <select
              data-workbench-view-select=""
              aria-label="已启动流程视图"
              value={view}
              onChange={event => changeView(event.target.value as View)}
              className="aiflow-type-control h-11 min-w-0 rounded-md border border-border bg-card px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {nav.map(item => (
                <option key={item.id} value={item.id}>
                  {labels[item.id]}
                  {item.count === null
                    ? ""
                    : `（${item.count === undefined ? "读取中" : item.count}）`}
                </option>
              ))}
            </select>
          </label>
          <nav
            data-workbench-view-navigation=""
            aria-label="已启动流程视图"
            className="hidden min-w-0 lg:mt-2 lg:grid lg:grid-cols-1 lg:gap-2"
          >
            {nav.map(item => (
              <button
                key={item.id}
                type="button"
                aria-label={labels[item.id]}
                aria-current={view === item.id ? "page" : undefined}
                title={sidebarCollapsed ? labels[item.id] : undefined}
                onClick={() => changeView(item.id)}
                className={`flex min-h-11 min-w-0 items-center gap-1.5 rounded px-2 py-2.5 text-left text-sm transition-colors lg:px-3 ${sidebarCollapsed ? "lg:justify-center" : ""} ${view === item.id ? "bg-accent font-semibold text-aiflow-info" : "text-muted-foreground hover:bg-muted"}`}
              >
                <item.icon size={16} />
                <span
                  className={`min-w-0 flex-1 whitespace-nowrap ${sidebarCollapsed ? "lg:hidden" : ""}`}
                >
                  {labels[item.id]}
                </span>
                {/* The dashboard cards already show these three totals; keep the unique done count here. */}
                {item.count !== null &&
                  (view !== "board" || item.id === "done") && (
                    <span
                      aria-label={
                        item.count === undefined
                          ? `${labels[item.id]}数量正在读取`
                          : `${item.count} 项`
                      }
                      className={`shrink-0 whitespace-nowrap rounded bg-card px-1.5 text-[10px] text-muted-foreground ${sidebarCollapsed ? "lg:hidden" : ""}`}
                    >
                      {item.count ?? "—"}
                    </span>
                  )}
              </button>
            ))}
          </nav>
          {!sidebarCollapsed && (
            <details
              data-workbench-navigation-help=""
              className="group mt-3 hidden border-t border-border px-2 lg:block"
            >
              <summary className="aiflow-type-control flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                <span>操作说明</span>
                <ChevronDown
                  aria-hidden="true"
                  size={14}
                  className="shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="aiflow-type-body pb-3 text-muted-foreground">
                人工操作由服务端暂停和续跑；移交、退回与批量处理逐项执行，任务仅在当前流程授权范围内可见。
              </p>
            </details>
          )}
        </aside>
        <section
          aria-label="流程工作台内容"
          data-workbench-content=""
          className="min-w-0"
        >
          {selectedRunId ? (
            <ProcessWorkbenchRunTab
              runId={selectedRunId}
              baseTabLabel={labels[view]}
              onClose={closeRunTab}
              onReturn={closeRunTab}
            />
          ) : (
            <section
              data-workbench-panel=""
              className="rounded-lg border border-border bg-card shadow-sm"
            >
              <header className="flex items-start justify-between gap-3 border-b border-border p-4 sm:items-center sm:p-5">
                <div className="min-w-0">
                  <p className="aiflow-type-meta hidden font-bold tracking-[.16em] text-muted-foreground sm:block">
                    PROCESS WORKBENCH
                  </p>
                  <h1
                    data-aiflow-page-title=""
                    className="aiflow-type-page-title font-semibold text-foreground sm:mt-1"
                  >
                    {labels[view]}
                  </h1>
                  <p className="aiflow-type-body mt-1 text-muted-foreground">
                    当前视图仅展示具备运行权限的流程实例与人工任务。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="刷新当前视图"
                  title="刷新当前视图"
                  className="aiflow-type-control min-h-11 min-w-11 shrink-0 px-2 sm:min-w-0 sm:px-3 lg:min-h-9"
                  onClick={() => {
                    if (view === "calendar") {
                      setCalendarCursorStack([undefined]);
                      setCalendarEvents([]);
                      setCalendarNextCursor(null);
                    }
                    invalidate();
                  }}
                >
                  <RefreshCw size={14} />
                  <span className="sr-only sm:not-sr-only">刷新</span>
                </Button>
              </header>
              {view === "board" && (
                <Board
                  dashboard={dashboard.data}
                  loading={dashboard.isLoading}
                  error={dashboard.error?.message}
                  onView={changeView}
                  onRetry={() => void dashboard.refetch()}
                  onTask={openTask}
                />
              )}
              {view === "calendar" &&
                (calendar.isError && !calendarEvents.length ? (
                  <QueryErrorState
                    title="日历加载失败"
                    message={calendar.error.message}
                    onRetry={() => void calendar.refetch()}
                  />
                ) : calendar.isLoading && !calendarEvents.length ? (
                  <LoadingState label="正在读取当前月份的流程任务…" />
                ) : (
                  <Calendar
                    month={month}
                    setMonth={changeCalendarMonth}
                    events={calendarEvents}
                    hasMore={Boolean(calendarNextCursor)}
                    loadingMore={calendar.isFetching}
                    loadMoreError={
                      calendar.isError ? calendar.error.message : undefined
                    }
                    onLoadMore={loadMoreCalendarEvents}
                    onTask={openTask}
                  />
                ))}
              {view === "todo" && selectedTaskIds.length > 0 && (
                <TaskBatchBar
                  count={selectedTaskIds.length}
                  busy={busy}
                  onClaim={() =>
                    batchClaim.mutate({ taskIds: selectedTaskIds })
                  }
                  onComplete={runBatchComplete}
                  decision={batchDecision}
                  comment={batchComment}
                  onDecision={setBatchDecision}
                  onComment={setBatchComment}
                />
              )}
              {["todo", "done", "initiated", "all"].includes(view) && (
                <WorkbenchListFilters
                  matchingCount={filteredListRows.length}
                  pageNumber={pageCursorStack.length}
                  pageSize={pageSize}
                  hasPreviousPage={pageCursorStack.length > 1}
                  hasNextPage={activeHasNextPage}
                  searchPending={searchPending}
                  pagingLoading={pagingLoading}
                  search={listSearch}
                  status={listStatus}
                  from={listFrom}
                  through={listThrough}
                  statusLabel={
                    ["todo", "done"].includes(view)
                      ? "任务状态"
                      : "流程状态 / 业务阶段"
                  }
                  statusOptions={listStatusOptions}
                  onSearch={value => {
                    setListSearch(value);
                    setSelectedTaskIds([]);
                  }}
                  onStatus={value => {
                    setListStatus(value);
                    setPageCursorStack([undefined]);
                    setSelectedTaskIds([]);
                  }}
                  onFrom={value => {
                    setListFrom(value);
                    setPageCursorStack([undefined]);
                    setSelectedTaskIds([]);
                  }}
                  onThrough={value => {
                    setListThrough(value);
                    setPageCursorStack([undefined]);
                    setSelectedTaskIds([]);
                  }}
                  onReset={() => {
                    setListSearch("");
                    setDebouncedListSearch("");
                    setListStatus("all");
                    setListFrom("");
                    setListThrough("");
                    setPageCursorStack([undefined]);
                    setSelectedTaskIds([]);
                  }}
                  onPageSize={value => {
                    setPageSize(value);
                    setPageCursorStack([undefined]);
                    setSelectedTaskIds([]);
                  }}
                  onPreviousPage={() => {
                    setSelectedTaskIds([]);
                    setPageCursorStack(current => current.slice(0, -1));
                  }}
                  onNextPage={() => {
                    const nextCursor = ["todo", "done"].includes(view)
                      ? taskPage?.nextCursor
                      : instancePage?.nextCursor;
                    if (nextCursor) {
                      setSelectedTaskIds([]);
                      setPageCursorStack(current => [...current, nextCursor]);
                    }
                  }}
                />
              )}
              {["todo", "done"].includes(view) && (
                <TaskList
                  key={`${view}:${listSearch}:${listStatus}:${listFrom}:${listThrough}:${pageSize}:${pageCursorStack.at(-1) ?? "first"}`}
                  tasks={filteredListRows}
                  loading={
                    tasks.isLoading ||
                    (pagingLoading && filteredListRows.length === 0)
                  }
                  error={tasks.isError ? tasks.error.message : undefined}
                  onRetry={() => void tasks.refetch()}
                  onTask={setSelectedTaskId}
                  onExecute={setSelectedTaskId}
                  busy={busy}
                  selectedTaskIds={selectedTaskIds}
                  onToggle={taskId =>
                    setSelectedTaskIds(current =>
                      current.includes(taskId)
                        ? current.filter(id => id !== taskId)
                        : [...current, taskId]
                    )
                  }
                  selectable={view === "todo"}
                  emptyMessage={
                    activeHasNextPage
                      ? "当前扫描区间暂无匹配记录，可继续扫描后续授权数据。"
                      : hasListFilters
                        ? "当前页没有符合筛选条件的记录，请继续扫描或调整筛选。"
                        : "当前范围内暂无可见人工任务。"
                  }
                />
              )}
              {["initiated", "all"].includes(view) && (
                <InstanceList
                  key={`${view}:${listSearch}:${listStatus}:${listFrom}:${listThrough}:${pageSize}:${pageCursorStack.at(-1) ?? "first"}`}
                  instances={filteredListRows}
                  loading={
                    instances.isLoading ||
                    (pagingLoading && filteredListRows.length === 0)
                  }
                  error={
                    instances.isError ? instances.error.message : undefined
                  }
                  onRetry={() => void instances.refetch()}
                  onOpenRun={setSelectedRunId}
                  emptyMessage={
                    activeHasNextPage
                      ? "当前扫描区间暂无匹配记录，可继续扫描后续授权数据。"
                      : hasListFilters
                        ? "当前页没有符合筛选条件的记录，请继续扫描或调整筛选。"
                        : "当前范围内暂无可见流程实例。"
                  }
                />
              )}
            </section>
          )}
        </section>
      </div>
      {selectedTaskId && (
        <TaskDrawer
          task={taskDetail.data as any}
          assignees={(assignees.data ?? []) as any[]}
          busy={busy}
          onClose={() => setSelectedTaskId(null)}
          onOpenRun={(runId: string) => {
            setSelectedTaskId(null);
            setSelectedRunId(runId);
          }}
          onClaim={() => claim.mutate({ taskId: selectedTaskId })}
          onExecute={(result: {
            decision: "approved" | "rejected" | "abstained";
            comment?: string;
            [key: string]: unknown;
          }) => execute.mutate({ taskId: selectedTaskId, result })}
          onComplete={(result: {
            decision: "approved" | "rejected" | "abstained";
            comment?: string;
            [key: string]: unknown;
          }) => complete.mutate({ taskId: selectedTaskId, result })}
          onHandover={(targetUserId: number) =>
            handover.mutate({ taskId: selectedTaskId, targetUserId })
          }
          onDelegate={(targetUserId: number) =>
            delegate.mutate({ taskId: selectedTaskId, targetUserId })
          }
          onAddSigner={(targetUserId: number, memberVersion: number) =>
            addSigner.mutate({
              taskId: selectedTaskId,
              targetUserId,
              memberVersion,
            })
          }
          onRemoveSigner={(memberTaskId: string, memberVersion: number) =>
            removeSigner.mutate({
              taskId: selectedTaskId,
              memberTaskId,
              memberVersion,
            })
          }
          onReturn={() => returnToPending.mutate({ taskId: selectedTaskId })}
        />
      )}
    </div>
  );
}

function TaskBatchBar({
  count,
  busy,
  onClaim,
  onComplete,
  decision,
  comment,
  onDecision,
  onComment,
}: {
  count: number;
  busy: boolean;
  onClaim: () => void;
  onComplete: () => void;
  decision: "approved" | "rejected" | "abstained";
  comment: string;
  onDecision: (value: "approved" | "rejected" | "abstained") => void;
  onComment: (value: string) => void;
}) {
  const actionLabel =
    decision === "rejected"
      ? "批量拒绝"
      : decision === "abstained"
        ? "批量弃权"
        : "批量同意";
  return (
    <div className="grid gap-3 border-b border-border bg-muted px-3 py-3 sm:px-5 lg:grid-cols-[minmax(220px,1fr)_minmax(320px,1.4fr)_auto] lg:items-end">
      <div className="aiflow-type-body text-muted-foreground">
        已选择 <strong className="text-foreground">{count}</strong>{" "}
        项。批量处理对每项分别进行权限与状态校验，不会跨流程或跨项目执行。
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[130px_minmax(0,1fr)]">
        <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
          批量决定
          <select
            className="h-11 rounded border border-border bg-card px-2 text-sm"
            value={decision}
            onChange={event =>
              onDecision(
                event.target.value as "approved" | "rejected" | "abstained"
              )
            }
          >
            <option value="approved">同意</option>
            <option value="rejected">拒绝</option>
            <option value="abstained">弃权</option>
          </select>
        </label>
        <label className="aiflow-type-control grid min-w-0 gap-1 font-medium text-muted-foreground">
          处理意见{decision === "rejected" ? "（必填）" : "（可选）"}
          <input
            className="h-11 min-w-0 rounded border border-border bg-card px-3 text-sm font-normal"
            maxLength={2000}
            value={comment}
            onChange={event => onComment(event.target.value)}
            placeholder={
              decision === "rejected" ? "请说明拒绝原因" : "可填写统一处理意见"
            }
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={!count || busy}
          onClick={onClaim}
        >
          <ListChecks size={14} />
          批量领取
        </Button>
        <Button
          type="button"
          className={`min-h-11 ${decision === "rejected" ? "bg-red-600 hover:bg-red-500" : decision === "abstained" ? "bg-slate-600 hover:bg-slate-500" : "bg-emerald-600 hover:bg-emerald-500"}`}
          disabled={
            !count || busy || (decision === "rejected" && !comment.trim())
          }
          onClick={onComplete}
        >
          <CheckCheck size={14} />
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function Board({
  dashboard,
  loading,
  error,
  onView,
  onRetry,
  onTask,
}: {
  dashboard: any;
  loading: boolean;
  error?: string;
  onView: (view: View) => void;
  onRetry: () => void;
  onTask: (id: string) => void;
}) {
  if (error)
    return (
      <QueryErrorState title="看板加载失败" message={error} onRetry={onRetry} />
    );
  if (loading || !dashboard)
    return <LoadingState label="正在加载当前授权范围内的看板统计与最近任务…" />;
  const counts = dashboard?.counts ?? {};
  return (
    <div className="p-5">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          {
            view: "todo" as const,
            icon: ListTodo,
            label: "待办",
            value: counts.todo ?? 0,
            tone: "amber",
          },
          {
            view: "initiated" as const,
            icon: Send,
            label: "我发起",
            value: counts.initiated ?? 0,
            tone: "blue",
          },
          {
            view: "all" as const,
            icon: UsersRound,
            label: "全部可见",
            value: counts.all ?? 0,
            tone: "slate",
          },
        ].map(item => (
          <button
            key={item.view}
            type="button"
            aria-label={`查看${item.label}流程`}
            className="min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={() => onView(item.view)}
          >
            <Stat
              icon={item.icon}
              label={item.label}
              value={item.value}
              tone={item.tone}
            />
          </button>
        ))}
      </div>
      <p className="aiflow-type-body mt-2 text-muted-foreground">
        “≥”表示已确认数量的下界，“待确认”表示快速扫描暂未确认总量；打开列表可继续核验授权范围。
      </p>
      <section className="mt-5 overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border px-4 py-3">
          <h2 className="aiflow-type-section-title font-semibold text-foreground">
            最近任务
          </h2>
          <p className="aiflow-type-body mt-1 text-muted-foreground">
            包含本人待办、已办和发起的近期任务；待办数只统计当前分配/候选给本人或由本人领取的任务。
          </p>
        </div>
        <div className="divide-y divide-border">
          {(dashboard?.recent ?? []).map((task: any) => {
            const readOnlyTask =
              ["pending", "claimed"].includes(task.status) &&
              task.canAct !== true;
            const currentHandler = task.claimedByName || task.assignedName;
            return (
              <button
                key={task.id}
                onClick={() => onTask(task.id)}
                className="flex min-w-0 w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
              >
                <CirclePlay size={15} className="text-aiflow-info" />
                <div className="min-w-0 flex-1">
                  <p className="aiflow-type-body truncate font-medium text-foreground">
                    {task.workflowName} · {task.nodeName}
                  </p>
                  <p className="aiflow-type-meta mt-1 tabular-nums text-muted-foreground">
                    {date(task.createdAt)}
                  </p>
                  <div className="aiflow-type-body mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                    <span className="min-w-0 break-words">
                      发起人 {task.initiatedByName || "内部用户"}
                    </span>
                    {currentHandler && (
                      <span className="min-w-0 max-w-full break-words">
                        经办人 {currentHandler}
                      </span>
                    )}
                  </div>
                </div>
                {badge(readOnlyTask ? "仅可查看" : task.status)}
              </button>
            );
          })}
          {!(dashboard?.recent ?? []).length && (
            <p className="aiflow-type-body p-8 text-center text-muted-foreground">
              暂无可见流程任务。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: any) {
  const colors: any = {
    amber: "bg-aiflow-warning-surface text-aiflow-warning",
    emerald: "bg-aiflow-success-surface text-aiflow-success",
    blue: "bg-aiflow-info-surface text-aiflow-info",
    slate: "bg-muted text-foreground",
  };
  return (
    <div
      className={`rounded-lg border border-border p-2 sm:p-4 ${colors[tone]}`}
    >
      <div className="aiflow-type-body flex min-w-0 items-center justify-between gap-1 font-medium">
        <span className="truncate whitespace-nowrap" title={label}>
          {label}
        </span>
        <Icon size={15} className="hidden shrink-0 sm:block" />
      </div>
      <p className="aiflow-type-display mt-1 font-bold sm:mt-2">{value}</p>
    </div>
  );
}

function WorkbenchListFilters({
  matchingCount,
  pageNumber,
  pageSize,
  hasPreviousPage,
  hasNextPage,
  searchPending,
  pagingLoading,
  search,
  status,
  from,
  through,
  statusLabel,
  statusOptions,
  onSearch,
  onStatus,
  onFrom,
  onThrough,
  onReset,
  onPageSize,
  onPreviousPage,
  onNextPage,
}: {
  matchingCount: number;
  pageNumber: number;
  pageSize: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  searchPending: boolean;
  pagingLoading: boolean;
  search: string;
  status: string;
  from: string;
  through: string;
  statusLabel: string;
  statusOptions: string[];
  onSearch: (value: string) => void;
  onStatus: (value: string) => void;
  onFrom: (value: string) => void;
  onThrough: (value: string) => void;
  onReset: () => void;
  onPageSize: (value: number) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const dateRangeInvalid = Boolean(from && through && from > through);
  const hasFilters = Boolean(
    search.trim() || status !== "all" || from || through
  );
  const advancedFilterCount =
    Number(status !== "all") + Number(Boolean(from)) + Number(Boolean(through));
  return (
    <div
      data-aiflow-workbench-list-filters=""
      aria-busy={pagingLoading}
      className="border-b border-border px-4 py-3"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="aiflow-type-control col-span-2 grid min-w-0 gap-1 font-medium text-muted-foreground sm:col-span-1">
          <span>关键词</span>
          <Input
            value={search}
            onChange={event => onSearch(event.target.value)}
            placeholder="流程、任务节点或发起人"
            aria-label="搜索流程、任务节点或发起人"
            className="h-11 lg:h-9"
          />
        </label>
        <details className="min-w-0">
          <summary
            aria-label={
              advancedFilterCount
                ? `更多筛选，已设置 ${advancedFilterCount} 项`
                : "更多筛选"
            }
            className="aiflow-type-control flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span>筛选条件</span>
            <span className="flex items-center gap-2">
              {advancedFilterCount > 0 && (
                <span className="aiflow-type-meta rounded bg-aiflow-info-surface px-2 py-0.5 text-aiflow-info">
                  已应用 {advancedFilterCount}
                </span>
              )}
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(140px,180px)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="aiflow-type-control grid min-w-0 gap-1 font-medium text-muted-foreground">
              <span>{statusLabel}</span>
              <select
                value={status}
                onChange={event => onStatus(event.target.value)}
                aria-label={`按${statusLabel}筛选`}
                className="h-11 min-w-0 rounded-md border border-border bg-card px-3 text-sm font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:h-9"
              >
                <option value="all">全部状态</option>
                {statusOptions.map(value => (
                  <option key={value} value={value}>
                    {formatStatusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="aiflow-type-control grid min-w-0 gap-1 font-medium text-muted-foreground">
              <span>创建时间从</span>
              <Input
                type="date"
                value={from}
                onChange={event => onFrom(event.target.value)}
                aria-label="创建时间开始"
                className="h-11 lg:h-9"
              />
            </label>
            <label className="aiflow-type-control grid min-w-0 gap-1 font-medium text-muted-foreground">
              <span>创建时间至</span>
              <Input
                type="date"
                value={through}
                onChange={event => onThrough(event.target.value)}
                aria-label="创建时间结束"
                className="h-11 lg:h-9"
              />
            </label>
          </div>
        </details>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasFilters}
          onClick={onReset}
          className="h-11 whitespace-nowrap px-3 lg:h-9"
        >
          重置筛选
        </Button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="status"
          aria-live="polite"
          className="aiflow-type-body text-muted-foreground"
        >
          {getWorkbenchListStatusMessage({
            searchPending,
            isFetching: pagingLoading && !searchPending,
            rowCount: matchingCount,
            pageNumber,
            hasNextPage,
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-11 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground lg:h-9">
            每页
            <select
              aria-label="每页条数"
              value={pageSize}
              onChange={event => onPageSize(Number(event.target.value))}
              className="h-11 rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:h-9"
            >
              <option value={20}>20 条</option>
              <option value={50}>50 条</option>
              <option value={100}>100 条</option>
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!hasPreviousPage || pagingLoading}
            onClick={onPreviousPage}
          >
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!hasNextPage || pagingLoading}
            onClick={onNextPage}
          >
            下一页
          </Button>
        </div>
      </div>
      {!pagingLoading && !matchingCount && hasNextPage && (
        <p className="aiflow-type-body mt-2 text-aiflow-warning">
          本页暂未找到符合授权条件的记录，仍有候选数据待扫描；继续翻页可完成核验。
        </p>
      )}
      {dateRangeInvalid && (
        <p role="alert" className="aiflow-type-body mt-1 text-aiflow-danger">
          开始日期不能晚于结束日期。
        </p>
      )}
    </div>
  );
}

function TaskList({
  tasks,
  loading,
  error,
  onRetry,
  onTask,
  onExecute,
  busy,
  selectedTaskIds,
  onToggle,
  selectable,
  emptyMessage,
}: {
  tasks: any[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onTask: (id: string) => void;
  onExecute: (id: string) => void;
  busy: boolean;
  selectedTaskIds: string[];
  onToggle: (id: string) => void;
  selectable: boolean;
  emptyMessage: string;
}) {
  const [mobileVisibleCount, setMobileVisibleCount] = useState(10);

  return (
    <>
      <div className="grid gap-2 p-3 md:grid-cols-2 lg:hidden">
        {error ? (
          <div className="md:col-span-2">
            <QueryErrorState
              title="任务加载失败"
              message={error}
              onRetry={onRetry}
            />
          </div>
        ) : loading ? (
          <div className="md:col-span-2">
            <LoadingState label="正在读取当前视图的人工任务…" />
          </div>
        ) : tasks.length ? (
          <>
            {tasks.slice(0, mobileVisibleCount).map(task => (
              <article
                key={task.id}
                data-workbench-task-card=""
                className="min-w-0 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="aiflow-type-body break-words font-semibold text-foreground">
                      {task.workflowName || "未命名流程"}
                    </h3>
                    <p className="aiflow-type-body mt-1 break-words text-muted-foreground">
                      {task.nodeName || "未命名任务节点"}
                    </p>
                    {approvalLabel(task) && (
                      <span className="aiflow-type-meta mt-1 inline-flex rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">
                        {approvalProgressText(task)}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0">
                    {badge(task.displayStatus || task.status)}
                  </span>
                </div>
                <dl className="aiflow-type-body mt-3 grid gap-1 border-t border-border pt-2">
                  <div className="flex min-w-0 justify-between gap-2">
                    <dt className="aiflow-type-body shrink-0 text-muted-foreground">
                      发起人
                    </dt>
                    <dd className="min-w-0 truncate text-right text-muted-foreground">
                      {task.initiatedByName || "—"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 justify-between gap-2">
                    <dt className="aiflow-type-body shrink-0 text-muted-foreground">
                      创建时间
                    </dt>
                    <dd className="min-w-0 break-words text-right tabular-nums text-muted-foreground">
                      {date(task.createdAt)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectable && (
                    <label
                      className="grid min-h-11 min-w-11 cursor-pointer place-items-center rounded border border-border"
                      aria-label={`选择任务 ${task.nodeName}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTaskIds.includes(task.id)}
                        onChange={() => onToggle(task.id)}
                        className="h-5 w-5 accent-[#2d6bea]"
                      />
                    </label>
                  )}
                  {task.status === "pending" && (
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11 flex-1 bg-emerald-600 text-xs hover:bg-emerald-500"
                      disabled={busy}
                      onClick={() => onExecute(task.id)}
                    >
                      {busy && <Loader2 className="animate-spin" size={13} />}
                      处理审批
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`min-h-11 ${selectable ? "flex-1" : "w-full"} text-xs text-aiflow-info`}
                    onClick={() => onTask(task.id)}
                  >
                    详情
                  </Button>
                </div>
              </article>
            ))}
            {tasks.length > mobileVisibleCount && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full md:col-span-2"
                onClick={() =>
                  setMobileVisibleCount(current =>
                    Math.min(tasks.length, current + 10)
                  )
                }
              >
                展开本页后续 {Math.min(10, tasks.length - mobileVisibleCount)}{" "}
                项 · 已显示 {mobileVisibleCount}/{tasks.length}
              </Button>
            )}
          </>
        ) : (
          <div className="aiflow-type-body rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground md:col-span-2">
            {emptyMessage}
          </div>
        )}
      </div>
      <div className="hidden lg:block">
        <Table
          headers={[
            ...(selectable ? ["选择"] : []),
            "流程 / 任务",
            "发起人",
            "状态",
            "创建时间",
            "操作",
          ]}
        >
          {error ? (
            <QueryErrorRow
              colSpan={selectable ? 6 : 5}
              message={error}
              onRetry={onRetry}
            />
          ) : loading ? (
            <Loading colSpan={selectable ? 6 : 5} />
          ) : tasks.length ? (
            tasks.map(task => (
              <tr key={task.id} className="border-t border-border">
                {selectable && (
                  <td className="px-4 py-3">
                    <label
                      className="grid min-h-11 min-w-11 cursor-pointer place-items-center"
                      aria-label={`选择任务 ${task.nodeName}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTaskIds.includes(task.id)}
                        onChange={() => onToggle(task.id)}
                        className="h-5 w-5 accent-[#2d6bea]"
                      />
                    </label>
                  </td>
                )}
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">
                    {task.workflowName}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {task.nodeName}
                    {approvalLabel(task) && (
                      <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-sm text-indigo-600">
                        {approvalProgressText(task)}
                      </span>
                    )}
                  </p>
                </td>
                <td className="aiflow-type-body px-4 py-3 text-muted-foreground">
                  {task.initiatedByName || "—"}
                </td>
                <td className="px-4 py-3">
                  {badge(task.displayStatus || task.status)}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {date(task.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {task.status === "pending" && (
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-11 bg-emerald-600 text-xs hover:bg-emerald-500"
                        disabled={busy}
                        onClick={() => onExecute(task.id)}
                      >
                        {busy && <Loader2 className="animate-spin" size={13} />}
                        处理审批
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 text-xs text-aiflow-info"
                      onClick={() => onTask(task.id)}
                    >
                      详情
                    </Button>
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={selectable ? 6 : 5} message={emptyMessage} />
          )}
        </Table>
      </div>
    </>
  );
}

function InstanceStatus({ run }: { run: any }) {
  const executionStatus = String(run.status || "unknown");
  const businessStatus =
    typeof run.stateName === "string" ? run.stateName.trim() : "";
  return (
    <div
      role="group"
      aria-label={businessStatus ? "运行状态和业务状态" : "运行状态"}
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      {badge(executionStatus)}
      {businessStatus && (
        <span className="aiflow-type-control max-w-full whitespace-normal break-words rounded border border-border bg-card px-1.5 py-0.5 text-muted-foreground">
          业务：{businessStatus}
        </span>
      )}
    </div>
  );
}

function InstanceList({
  instances,
  loading,
  error,
  onRetry,
  onOpenRun,
  emptyMessage,
}: {
  instances: any[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onOpenRun: (id: string) => void;
  emptyMessage: string;
}) {
  const [mobileVisibleCount, setMobileVisibleCount] = useState(10);

  return (
    <>
      <div className="grid gap-2 p-3 md:grid-cols-2 lg:hidden">
        {error ? (
          <div className="md:col-span-2">
            <QueryErrorState
              title="流程实例加载失败"
              message={error}
              onRetry={onRetry}
            />
          </div>
        ) : loading ? (
          <div className="md:col-span-2">
            <LoadingState label="正在读取当前授权范围的流程实例…" />
          </div>
        ) : instances.length ? (
          <>
            {instances.slice(0, mobileVisibleCount).map(run => (
              <article
                key={run.id}
                data-workbench-instance-card=""
                className="min-w-0 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <h3
                    data-workbench-instance-name=""
                    className="aiflow-type-body min-w-0 flex-1 break-words font-semibold text-foreground"
                  >
                    {(run.workflowName || "未命名流程").replaceAll(
                      "_",
                      "_\u200b"
                    )}
                  </h3>
                </div>
                <div className="mt-2">
                  <InstanceStatus run={run} />
                </div>
                <dl className="aiflow-type-body mt-3 grid gap-1 border-t border-border pt-2">
                  <div className="flex min-w-0 justify-between gap-2">
                    <dt className="aiflow-type-meta shrink-0 text-muted-foreground">
                      实例编号
                    </dt>
                    <dd className="aiflow-type-meta min-w-0 truncate text-right font-mono text-muted-foreground">
                      {run.id.slice(0, 8)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 justify-between gap-2">
                    <dt className="aiflow-type-body shrink-0 text-muted-foreground">
                      发起人
                    </dt>
                    <dd className="aiflow-type-body min-w-0 break-words text-right text-muted-foreground">
                      {run.initiatedByName || "—"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 justify-between gap-2">
                    <dt className="aiflow-type-meta shrink-0 text-muted-foreground">
                      创建时间
                    </dt>
                    <dd className="aiflow-type-meta min-w-0 break-words text-right tabular-nums text-muted-foreground">
                      {date(run.createdAt)}
                    </dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="aiflow-type-control mt-3 min-h-11 w-full text-aiflow-info"
                  onClick={() => onOpenRun(run.id)}
                >
                  实例详情
                </Button>
              </article>
            ))}
            {instances.length > mobileVisibleCount && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full md:col-span-2"
                onClick={() =>
                  setMobileVisibleCount(current =>
                    Math.min(instances.length, current + 10)
                  )
                }
              >
                展开本页后续{" "}
                {Math.min(10, instances.length - mobileVisibleCount)} 项 ·{" "}
                已显示 {mobileVisibleCount}/{instances.length}
              </Button>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2">
            {emptyMessage}
          </div>
        )}
      </div>
      <div className="hidden lg:block">
        <Table
          headers={[
            "流程实例",
            "发起人",
            "运行状态 / 业务状态",
            "创建时间",
            "操作",
          ]}
          columnWidths={["32%", "15%", "24%", "18%", "11%"]}
        >
          {error ? (
            <QueryErrorRow colSpan={5} message={error} onRetry={onRetry} />
          ) : loading ? (
            <Loading />
          ) : instances.length ? (
            instances.map(run => (
              <tr key={run.id} className="border-t border-border">
                <td className="min-w-0 px-3 py-3">
                  <p
                    data-workbench-instance-name=""
                    className="aiflow-type-body max-w-full break-words whitespace-normal font-medium text-foreground"
                    title={run.workflowName}
                  >
                    {run.workflowName.replaceAll("_", "_\u200b")}
                  </p>
                  <code className="aiflow-type-code mt-1 block truncate whitespace-nowrap text-muted-foreground">
                    {run.id.slice(0, 8)}
                  </code>
                </td>
                <td
                  className="aiflow-type-body min-w-0 break-words whitespace-normal px-3 py-3 align-top text-muted-foreground"
                  title={run.initiatedByName || "—"}
                >
                  {run.initiatedByName || "—"}
                </td>
                <td className="min-w-0 px-3 py-3 align-top">
                  <InstanceStatus run={run} />
                </td>
                <td className="aiflow-type-meta whitespace-nowrap px-3 py-3 text-muted-foreground">
                  {date(run.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title={
                      !(run.availableOperations ?? []).length
                        ? "无可执行操作；仅可查看实例详情"
                        : "打开实例详情"
                    }
                    className="min-h-11 px-1 text-xs text-aiflow-info"
                    onClick={() => onOpenRun(run.id)}
                  >
                    实例详情
                  </Button>
                </td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={5} message={emptyMessage} />
          )}
        </Table>
      </div>
    </>
  );
}

function QueryErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="grid min-h-[260px] place-items-center p-8 text-center"
    >
      <div className="max-w-md">
        <AlertTriangle className="mx-auto text-rose-500" size={25} />
        <p className="aiflow-type-section-title mt-3 font-semibold text-foreground">
          {title}
        </p>
        <p className="aiflow-type-body mt-1 break-words text-muted-foreground">
          {message || "暂时无法读取数据。"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={onRetry}
        >
          <RotateCcw size={14} /> 重试
        </Button>
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div
      data-process-workbench-loading
      role="status"
      aria-live="polite"
      className="grid min-h-[260px] place-items-center p-8 text-center"
    >
      <div>
        <Loader2 className="mx-auto animate-spin text-aiflow-info" size={24} />
        <p className="aiflow-type-body mt-3 font-medium text-foreground">
          正在读取已启动流程
        </p>
        <p className="aiflow-type-body mt-1 text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function QueryErrorRow({
  colSpan,
  message,
  onRetry,
}: {
  colSpan: number;
  message: string;
  onRetry: () => void;
}) {
  return (
    <tr role="alert">
      <td colSpan={colSpan} className="p-8 text-center">
        <AlertTriangle className="mx-auto text-rose-500" size={20} />
        <p className="aiflow-type-section-title mt-2 font-medium text-foreground">
          查询失败
        </p>
        <p className="aiflow-type-body mt-1 break-words text-muted-foreground">
          {message || "暂时无法读取数据。"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onRetry}
        >
          <RotateCcw size={13} />
          重试
        </Button>
      </td>
    </tr>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="aiflow-type-body p-8 text-center text-muted-foreground"
      >
        {message}
      </td>
    </tr>
  );
}

function Table({
  children,
  headers = ["流程 / 任务", "发起人", "状态", "创建时间", "操作"],
  columnWidths,
}: {
  children: React.ReactNode;
  headers?: string[];
  columnWidths?: string[];
}) {
  return (
    <div className="overflow-x-auto p-5">
      <table
        className={`w-full min-w-[760px] text-left text-sm ${columnWidths ? "table-fixed" : ""}`}
      >
        {columnWidths && (
          <colgroup>
            {columnWidths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
        )}
        <thead className="bg-muted text-sm font-medium text-muted-foreground">
          <tr>
            {headers.map(header => (
              <th key={header} className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Loading({ colSpan = 5 }: { colSpan?: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-8 text-center">
        <Loader2
          className="mx-auto animate-spin text-muted-foreground"
          size={18}
        />
      </td>
    </tr>
  );
}

function calendarDayKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type CalendarEvent = {
  id: string;
  title: string;
  start: string | Date;
  status?: string;
};
function Calendar({
  month,
  setMonth,
  events,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  onTask,
}: {
  month: Date;
  setMonth: (date: Date) => void;
  events: CalendarEvent[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError?: string;
  onLoadMore: () => void;
  onTask: (id: string) => void;
}) {
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    calendarDayKey(new Date())
  );
  const [agendaVisibleLimits, setAgendaVisibleLimits] = useState<
    Record<string, number>
  >({});

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return value;
  });
  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const startAt = new Date(String(event.start));
      if (Number.isNaN(startAt.getTime())) continue;
      const key = calendarDayKey(startAt);
      const sameDay = grouped.get(key) ?? [];
      sameDay.push(event);
      grouped.set(key, sameDay);
    }
    grouped.forEach(sameDay => {
      sameDay.sort(
        (left, right) =>
          new Date(String(left.start)).getTime() -
          new Date(String(right.start)).getTime()
      );
    });
    return grouped;
  }, [events]);
  const agendaDays = days.filter(
    day =>
      day.getMonth() === month.getMonth() &&
      day.getFullYear() === month.getFullYear() &&
      (eventsByDay.get(calendarDayKey(day))?.length ?? 0) > 0
  );
  const selectedDay = new Date(`${selectedDayKey}T12:00:00`);
  const selectedEvents = eventsByDay.get(selectedDayKey) ?? [];
  const selectedVisibleLimit = Math.min(
    agendaVisibleLimits[selectedDayKey] ?? CALENDAR_AGENDA_PAGE_SIZE,
    selectedEvents.length
  );
  const visibleSelectedEvents = selectedEvents.slice(0, selectedVisibleLimit);

  const selectDay = (day: Date) => {
    setSelectedDayKey(calendarDayKey(day));
    if (
      day.getMonth() !== month.getMonth() ||
      day.getFullYear() !== month.getFullYear()
    ) {
      setAgendaVisibleLimits({});
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  };
  const changeMonth = (offset: number) => {
    const nextMonth = new Date(
      month.getFullYear(),
      month.getMonth() + offset,
      1
    );
    setAgendaVisibleLimits({});
    setMonth(nextMonth);
    setSelectedDayKey(calendarDayKey(nextMonth));
  };
  const showCurrentMonth = () => {
    const today = new Date();
    setAgendaVisibleLimits({});
    setMonth(today);
    setSelectedDayKey(calendarDayKey(today));
  };

  return (
    <div className="p-5">
      <div className="mb-4 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_auto_auto] items-center gap-1 sm:flex sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="上月"
            title="上月"
            className="min-h-11 min-w-11 px-2 lg:min-h-9"
            onClick={() => changeMonth(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">上月</span>
          </Button>
          <p className="min-w-0 whitespace-nowrap text-center text-sm font-semibold text-foreground sm:text-base">
            {month.getFullYear()} 年 {month.getMonth() + 1} 月
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="回到本月"
            title="回到本月"
            className="min-h-11 min-w-11 px-2 lg:min-h-9"
            onClick={showCurrentMonth}
          >
            本月
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="下月"
            title="下月"
            className="min-h-11 min-w-11 px-2 lg:min-h-9"
            onClick={() => changeMonth(1)}
          >
            <span className="sr-only sm:not-sr-only">下月</span>
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          <span
            className="aiflow-type-body min-w-0 text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            本月已载入 {events.length} 条授权任务
            {hasMore ? " · 可继续扫描" : " · 已扫描至末尾"}
          </span>
          {hasMore && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore
                ? "读取中…"
                : loadMoreError
                  ? "重试载入"
                  : "载入更多任务"}
            </Button>
          )}
        </div>
      </div>
      <p className="aiflow-type-body text-muted-foreground">
        此日历按任务创建时间归档，不表示计划办理日或截止日。
      </p>
      {loadMoreError && events.length > 0 && (
        <p role="alert" className="aiflow-type-body mb-3 text-aiflow-danger">
          后续任务载入失败，已显示的日历记录仍保留；可重试载入。
        </p>
      )}
      <p className="aiflow-type-body mb-2 text-muted-foreground">
        每天先显示 2 项，更多任务可按需展开；其余月份数据按需载入。
      </p>
      <section
        className="mb-5 grid gap-2 sm:hidden"
        aria-label={`${month.getFullYear()}年${month.getMonth() + 1}月流程日程`}
      >
        {agendaDays.length === 0 ? (
          <p className="aiflow-type-body rounded-lg border border-dashed border-input bg-card px-4 py-8 text-center text-muted-foreground">
            本月暂无流程任务。
          </p>
        ) : (
          agendaDays.map(day => {
            const dayKey = calendarDayKey(day);
            const dayEvents = eventsByDay.get(dayKey) ?? [];
            const visibleEventLimit = Math.min(
              agendaVisibleLimits[dayKey] ?? CALENDAR_DAY_PREVIEW_LIMIT,
              dayEvents.length
            );
            const visibleDayEvents = dayEvents.slice(0, visibleEventLimit);
            const hasHiddenEvents = visibleDayEvents.length < dayEvents.length;
            const hasExpandedEvents =
              visibleEventLimit > CALENDAR_DAY_PREVIEW_LIMIT;
            return (
              <section
                key={dayKey}
                className={`overflow-hidden rounded-lg border bg-card ${dayKey === selectedDayKey ? "border-blue-300 ring-1 ring-blue-200" : "border-border"}`}
              >
                <button
                  type="button"
                  onClick={() => selectDay(day)}
                  aria-pressed={dayKey === selectedDayKey}
                  className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border bg-muted px-3 text-left text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                >
                  <span>
                    {day.toLocaleDateString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      weekday: "long",
                    })}
                  </span>
                  <span className="aiflow-type-meta rounded-full bg-aiflow-info-surface px-2 py-0.5 font-medium tabular-nums text-aiflow-info">
                    {dayEvents.length} 项
                  </span>
                </button>
                <ul
                  id={`calendar-agenda-${dayKey}`}
                  className="divide-y divide-border"
                >
                  {visibleDayEvents.map(event => {
                    const startAt = new Date(String(event.start));
                    return (
                      <li
                        key={event.id}
                        className="flex items-center gap-3 px-3 py-3"
                      >
                        <span className="aiflow-type-meta w-12 shrink-0 tabular-nums text-muted-foreground">
                          {Number.isNaN(startAt.getTime())
                            ? "—"
                            : startAt.toLocaleTimeString("zh-CN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              })}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 break-words text-sm text-foreground">
                            {event.title || "未命名任务"}
                          </p>
                          {event.status && (
                            <span className="mt-1 inline-flex">
                              {badge(String(event.status))}
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="aiflow-type-control min-h-11 min-w-11 shrink-0 px-2.5"
                          onClick={() => onTask(String(event.id))}
                        >
                          查看
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                {dayEvents.length > CALENDAR_DAY_PREVIEW_LIMIT && (
                  <div className="grid gap-1 border-t border-border p-1 sm:flex sm:justify-end">
                    {hasHiddenEvents && (
                      <button
                        type="button"
                        aria-controls={`calendar-agenda-${dayKey}`}
                        aria-expanded={hasExpandedEvents}
                        aria-label={`显示后续任务，当前已显示 ${visibleDayEvents.length} 项，共 ${dayEvents.length} 项`}
                        className="min-h-11 w-full px-3 text-sm font-medium text-aiflow-info hover:bg-aiflow-info-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:w-auto"
                        onClick={() =>
                          setAgendaVisibleLimits(current => ({
                            ...current,
                            [dayKey]: getCalendarAgendaVisibleLimit(
                              dayEvents.length,
                              visibleEventLimit,
                              "show-more"
                            ),
                          }))
                        }
                      >
                        {`显示后续 ${Math.min(CALENDAR_AGENDA_PAGE_SIZE, dayEvents.length - visibleDayEvents.length)} 项 · ${visibleDayEvents.length}/${dayEvents.length}`}
                      </button>
                    )}
                    {hasExpandedEvents && (
                      <button
                        type="button"
                        aria-controls={`calendar-agenda-${dayKey}`}
                        aria-label={`收起已显示任务到前 ${CALENDAR_DAY_PREVIEW_LIMIT} 项`}
                        className="min-h-11 w-full px-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:w-auto"
                        onClick={() =>
                          setAgendaVisibleLimits(current => ({
                            ...current,
                            [dayKey]: getCalendarAgendaVisibleLimit(
                              dayEvents.length,
                              visibleEventLimit,
                              "collapse"
                            ),
                          }))
                        }
                      >
                        {`收起到前 ${CALENDAR_DAY_PREVIEW_LIMIT} 项`}
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })
        )}
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)]">
        <div className="aiflow-type-meta hidden min-w-0 grid-cols-7 border-l border-t border-border sm:grid">
          {"日一二三四五六".split("").map(day => (
            <div
              key={day}
              className="border-b border-r border-border bg-muted p-2 text-center font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
          {days.map(day => (
            <section
              key={calendarDayKey(day)}
              className={`min-h-[88px] border-b border-r border-border p-1 sm:min-h-[104px] sm:p-2 ${day.getMonth() !== month.getMonth() ? "bg-muted text-muted-foreground" : "bg-card"} ${calendarDayKey(day) === selectedDayKey ? "ring-2 ring-inset ring-blue-500" : ""}`}
            >
              <button
                type="button"
                onClick={() => selectDay(day)}
                aria-label={`查看 ${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日，${(eventsByDay.get(calendarDayKey(day)) ?? []).length} 项任务`}
                aria-pressed={calendarDayKey(day) === selectedDayKey}
                className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left font-medium hover:bg-aiflow-info-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span>{day.getDate()}</span>
                {(eventsByDay.get(calendarDayKey(day)) ?? []).length > 0 && (
                  <span className="aiflow-type-meta rounded-full bg-aiflow-info-surface px-1.5 text-aiflow-info">
                    {(eventsByDay.get(calendarDayKey(day)) ?? []).length}
                  </span>
                )}
              </button>
              <div className="mt-1 grid gap-1">
                {(eventsByDay.get(calendarDayKey(day)) ?? [])
                  .slice(0, CALENDAR_DAY_PREVIEW_LIMIT)
                  .map(event => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onTask(event.id)}
                      title={event.title}
                      className="aiflow-type-control truncate rounded bg-aiflow-info-surface px-1 py-0.5 text-left text-aiflow-info hover:bg-aiflow-info-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      {event.title}
                    </button>
                  ))}
                {(eventsByDay.get(calendarDayKey(day)) ?? []).length >
                  CALENDAR_DAY_PREVIEW_LIMIT && (
                  <button
                    type="button"
                    onClick={() => selectDay(day)}
                    className="aiflow-type-control rounded px-1 text-left font-medium text-aiflow-info hover:bg-aiflow-info-surface"
                  >
                    +
                    {(eventsByDay.get(calendarDayKey(day)) ?? []).length -
                      CALENDAR_DAY_PREVIEW_LIMIT}{" "}
                    项
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
        <section
          aria-labelledby="calendar-selected-day-title"
          className="hidden min-w-0 overflow-hidden rounded-lg border border-border sm:block lg:sticky lg:top-24"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-3">
            <div>
              <h3
                id="calendar-selected-day-title"
                className="font-semibold text-foreground"
              >
                {selectedDay.getFullYear()} 年 {selectedDay.getMonth() + 1} 月{" "}
                {selectedDay.getDate()} 日
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                当天已载入 {selectedEvents.length} 项任务
              </p>
            </div>
            <CalendarDays
              size={18}
              className="text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          {selectedEvents.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              当天没有流程任务
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visibleSelectedEvents.map(event => {
                const startAt = new Date(String(event.start));
                return (
                  <li
                    key={event.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <span className="aiflow-type-meta shrink-0 tabular-nums text-muted-foreground">
                      {Number.isNaN(startAt.getTime())
                        ? "时间未提供"
                        : startAt.toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-sm text-foreground">
                      {event.title || "未命名任务"}
                    </span>
                    {event.status && badge(String(event.status))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start sm:ml-2 sm:self-auto"
                      onClick={() => onTask(String(event.id))}
                    >
                      查看任务
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {selectedEvents.length > CALENDAR_AGENDA_PAGE_SIZE && (
            <div className="border-t border-border px-4 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="aiflow-type-meta text-muted-foreground">
                  已显示 {selectedVisibleLimit} / {selectedEvents.length} 项
                </span>
                <div className="flex flex-wrap gap-1">
                  {selectedVisibleLimit < selectedEvents.length && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      onClick={() =>
                        setAgendaVisibleLimits(current => ({
                          ...current,
                          [selectedDayKey]: Math.min(
                            selectedEvents.length,
                            selectedVisibleLimit + CALENDAR_AGENDA_PAGE_SIZE
                          ),
                        }))
                      }
                    >
                      {`显示后续 ${Math.min(CALENDAR_AGENDA_PAGE_SIZE, selectedEvents.length - selectedVisibleLimit)} 项`}
                    </Button>
                  )}
                  {selectedVisibleLimit > CALENDAR_AGENDA_PAGE_SIZE && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      onClick={() =>
                        setAgendaVisibleLimits(current => ({
                          ...current,
                          [selectedDayKey]: CALENDAR_AGENDA_PAGE_SIZE,
                        }))
                      }
                    >
                      收起到前 {CALENDAR_AGENDA_PAGE_SIZE} 项
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function taskOutcomeOptions(task: any): Array<{
  code: string;
  label: string;
  requireComment?: boolean;
}> {
  let contract = task?.outcomeHandlesJson;
  if (typeof contract === "string") {
    try {
      contract = JSON.parse(contract);
    } catch {
      contract = null;
    }
  }
  if (contract?.mode === "explicit" && Array.isArray(contract.outcomes)) {
    const outcomes = contract.outcomes
      .filter((item: any) => item && typeof item === "object")
      .map((item: any) => ({
        code: String(item.code ?? "").trim(),
        label: String(item.label ?? item.code ?? "").trim(),
        ...(item.requireComment === true ? { requireComment: true } : {}),
      }))
      .filter((item: any) => item.code && item.label);
    if (outcomes.length) return outcomes;
  }
  return [
    { code: "approved", label: "同意" },
    { code: "rejected", label: "拒绝", requireComment: true },
    { code: "abstained", label: "弃权" },
  ];
}

function taskFormFields(task: any): Array<{
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string;
  readOnly: boolean;
  options: unknown[];
}> {
  const fields = task?.payload?.config?.formSchema?.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((item: any) => item && typeof item === "object")
    .map((item: any) => ({
      key: String(item.key ?? "").trim(),
      label: String(item.label ?? item.key ?? "").trim(),
      type: String(item.type ?? "text").toLowerCase(),
      required: item.required === true,
      readOnly: item.readOnly === true,
      options: Array.isArray(item.options) ? item.options : [],
      defaultValue: Array.isArray(item.defaultValue)
        ? JSON.stringify(item.defaultValue)
        : String(
            item.defaultValue ??
              (item.type === "boolean" && !item.readOnly ? false : "")
          ),
    }))
    .filter((item: any) => item.key && item.label);
}

function TaskDrawer({
  task,
  assignees,
  busy,
  onClose,
  onOpenRun,
  onClaim,
  onExecute,
  onComplete,
  onHandover,
  onDelegate,
  onAddSigner,
  onRemoveSigner,
  onReturn,
}: any) {
  const [targetUserId, setTargetUserId] = useState("");
  const [removeMemberTaskId, setRemoveMemberTaskId] = useState("");
  const configuredOutcomes = useMemo(
    () => taskOutcomeOptions(task),
    [task?.outcomeHandlesJson]
  );
  const [outcome, setOutcome] = useState("approved");
  const selectedOutcome =
    configuredOutcomes.find(item => item.code === outcome) ??
    configuredOutcomes[0];
  const decision: "approved" | "rejected" | "abstained" =
    selectedOutcome?.code === "abstained"
      ? "abstained"
      : ["rejected", "returned", "cancelled"].includes(
            selectedOutcome?.code ?? ""
          )
        ? "rejected"
        : "approved";
  const commentRequired =
    selectedOutcome?.requireComment === true || decision === "rejected";
  const [comment, setComment] = useState("");
  const [resultRows, setResultRows] = useState<
    Array<{ key: string; value: string }>
  >([]);
  const formFields = useMemo(
    () => taskFormFields(task),
    [task?.id, task?.formSchemaVersion, task?.payload]
  );
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  useEffect(() => {
    if (!configuredOutcomes.some(item => item.code === outcome))
      setOutcome(configuredOutcomes[0]?.code ?? "approved");
  }, [configuredOutcomes, outcome]);
  useEffect(() => {
    setResultRows(
      formFields.map(field => ({ key: field.key, value: field.defaultValue }))
    );
  }, [task?.id, task?.formSchemaVersion]);
  const toValue = (value: string): unknown =>
    value === "true"
      ? true
      : value === "false"
        ? false
        : value !== "" && Number.isFinite(Number(value))
          ? Number(value)
          : value;
  const createPayload = (rows: Array<{ key: string; value: string }>) => ({
    ...Object.fromEntries(
      rows
        .filter(
          row =>
            row.key.trim() &&
            !["decision", "comment", "outcome"].includes(row.key.trim()) &&
            !(
              row.value === "" &&
              formFields.some(field => field.key === row.key)
            )
        )
        .map(row => {
          const field = formFields.find(field => field.key === row.key);
          return [
            row.key,
            field
              ? taskFormInputValue(field.type, row.value)
              : toValue(row.value),
          ];
        })
    ),
    decision,
    outcome: selectedOutcome?.code ?? decision,
    ...(comment.trim() ? { comment: comment.trim() } : {}),
  });
  const canManage = canManageTask(task);
  const isHistoricalTask =
    task?.status === "completed" || task?.status === "cancelled";
  const taskHistoryNotice =
    task?.status === "completed"
      ? "此任务已完成，以下为历史处理记录。"
      : task?.status === "cancelled"
        ? "此任务已取消，当前为只读记录。"
        : null;
  const taskInstruction =
    task?.instruction?.trim() ||
    (isHistoricalTask
      ? "未配置操作说明。"
      : canManage
        ? "请完成当前人工操作。"
        : "请由指定处理人完成当前人工操作。");
  const taskInstructionLabel = isHistoricalTask
    ? "原操作说明"
    : canManage
      ? "操作说明"
      : "指定处理人办理说明";
  const missingRequiredFormField = formFields.some(field => {
    if (!field.required) return false;
    const value = resultRows.find(row => row.key === field.key)?.value ?? "";
    const parsed = taskFormInputValue(field.type, value);
    return !value.trim() || (Array.isArray(parsed) && !parsed.length);
  });
  const setFormFieldValue = (key: string, value: string) =>
    setResultRows(rows => {
      const index = rows.findIndex(row => row.key === key);
      return index < 0
        ? [...rows, { key, value }]
        : rows.map((row, rowIndex) =>
            rowIndex === index ? { ...row, value } : row
          );
    });
  const submitResult = () => {
    const payload = createPayload(resultRows);
    if (task.status === "pending") onExecute(payload);
    else onComplete(payload);
  };
  const updateRow = (index: number, key: "key" | "value", value: string) =>
    setResultRows(rows =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      )
    );
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/25"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workflow-task-drawer-title"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="h-full w-full max-w-lg overflow-y-auto bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="aiflow-type-meta font-bold tracking-[.16em] text-muted-foreground">
              MANUAL TASK
            </p>
            <h3
              id="workflow-task-drawer-title"
              className="mt-1 text-lg font-semibold text-foreground"
            >
              {task?.workflowName || "正在读取任务…"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {task?.nodeName}
              {approvalLabel(task) && (
                <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-sm text-indigo-600">
                  {approvalProgressText(task)}
                </span>
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11"
            onClick={onClose}
            autoFocus
          >
            关闭
          </Button>
        </div>
        {task && (
          <div className="mt-5 space-y-5">
            {(task.status === "pending" || task.status === "claimed") &&
              task.canAct !== true && (
                <div className="flex flex-col gap-3 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p role="status" className="text-sm leading-6 text-amber-900">
                    此任务仅供查看；处理操作由指定处理人完成。
                  </p>
                  {task.canViewRun === true && task.runId && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 shrink-0"
                      onClick={() => onOpenRun(String(task.runId))}
                    >
                      查看运行详情
                    </Button>
                  )}
                </div>
              )}
            {taskHistoryNotice && (
              <p
                role="status"
                className="rounded-lg border border-border bg-muted px-4 py-3 text-sm leading-6 text-foreground"
              >
                {taskHistoryNotice}
              </p>
            )}
            <div className="rounded-lg border border-border bg-muted p-4">
              <p className="aiflow-type-body font-semibold text-muted-foreground">
                {taskInstructionLabel}
              </p>
              <p className="mt-2 text-sm leading-6 text-foreground">
                {taskInstruction}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {badge(task.displayStatus || task.status)}
                <span className="aiflow-type-meta text-muted-foreground">
                  创建于 {date(task.createdAt)}
                </span>
                {task.formSchemaVersion && (
                  <span className="aiflow-type-meta text-muted-foreground">
                    表单版本 v{task.formSchemaVersion}
                  </span>
                )}
                {task.dueAt && (
                  <span className="aiflow-type-meta text-muted-foreground">
                    截止于 {date(task.dueAt)}
                  </span>
                )}
                {task.assignedName && (
                  <span className="text-sm text-muted-foreground">
                    指定处理人：{task.assignedName}
                  </span>
                )}
                {task.claimedByName &&
                  Number(task.claimedByUserId) !==
                    Number(task.assignedUserId) && (
                    <span className="text-sm text-muted-foreground">
                      当前经办人：{task.claimedByName}
                    </span>
                  )}
                {task.responsibleName && (
                  <span className="text-sm text-muted-foreground">
                    责任主体：{task.responsibleName}
                  </span>
                )}
                {task.representedName && (
                  <span className="text-sm text-indigo-700">
                    代理关系：代表 {task.representedName} 办理
                  </span>
                )}
              </div>
            </div>
            {canManage && (
              <div className="rounded-lg border border-aiflow-info-border bg-aiflow-info-surface/50 p-4">
                <p className="aiflow-type-body font-semibold text-foreground">
                  任务移交与回退
                </p>
                <p className="aiflow-type-body mt-1 text-muted-foreground">
                  仅显示拥有该流程运行权限的内部用户。移交变更责任人；代理同时保留被代理主体。两者都不会直接推进流程。
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <select
                    aria-label="选择移交处理人"
                    value={targetUserId}
                    onChange={event => setTargetUserId(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded border border-border bg-card px-2 text-sm"
                  >
                    <option value="">选择可分配处理人</option>
                    {assignees.map((item: any) => (
                      <option key={item.id} value={item.id}>
                        {item.name || item.username}（{item.username}）
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || !targetUserId}
                    onClick={() => onHandover(Number(targetUserId))}
                  >
                    <UserRoundPlus size={14} />
                    移交
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || !targetUserId}
                    onClick={() => onDelegate(Number(targetUserId))}
                  >
                    <UsersRound size={14} />
                    代理
                  </Button>
                </div>
                {task.approvalGroupId && (
                  <div className="mt-3 border-t border-aiflow-info-border pt-3">
                    <p className="aiflow-type-body font-semibold text-foreground">
                      加签与减签
                    </p>
                    <p className="aiflow-type-body mt-1 text-muted-foreground">
                      成员变更使用任务组版本校验；已领取或已决定的成员不能减签。
                    </p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || !targetUserId}
                        onClick={() =>
                          onAddSigner(
                            Number(targetUserId),
                            Number(task.memberVersion ?? 0)
                          )
                        }
                      >
                        <UserRoundPlus size={14} />
                        加签
                      </Button>
                      <select
                        aria-label="选择减签成员"
                        value={removeMemberTaskId}
                        onChange={event =>
                          setRemoveMemberTaskId(event.target.value)
                        }
                        className="h-9 min-w-0 flex-1 rounded border border-border bg-card px-2 text-sm"
                      >
                        <option value="">选择未处理成员</option>
                        {(task.approvalMembers ?? [])
                          .filter(
                            (member: any) =>
                              member.id !== task.id &&
                              member.status === "pending"
                          )
                          .map((member: any) => (
                            <option key={member.id} value={member.id}>
                              {member.assignedName ||
                                member.assignedUsername ||
                                member.assignedUserId}
                            </option>
                          ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || !removeMemberTaskId}
                        onClick={() =>
                          onRemoveSigner(
                            removeMemberTaskId,
                            Number(task.memberVersion ?? 0)
                          )
                        }
                      >
                        减签
                      </Button>
                    </div>
                  </div>
                )}
                {task.status === "claimed" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={busy}
                    onClick={onReturn}
                  >
                    <RotateCcw size={14} />
                    退回待处理
                  </Button>
                )}
              </div>
            )}
            {canManage && (
              <div className="rounded-lg border border-aiflow-success-border bg-aiflow-success-surface/40 p-4">
                {formFields.length > 0 && (
                  <div className="mb-4 rounded-lg border border-border bg-card p-3">
                    <p className="aiflow-type-section-title font-semibold text-muted-foreground">
                      任务表单 · v{task.formSchemaVersion ?? 1}
                    </p>
                    <div className="mt-3 grid gap-3">
                      {formFields.map(field => (
                        <div
                          key={field.key}
                          className="grid gap-1 text-sm font-medium text-foreground"
                        >
                          {field.label}
                          {field.required ? "（必填）" : "（可选）"}
                          <TaskFormField
                            field={field}
                            value={
                              resultRows.find(row => row.key === field.key)
                                ?.value ?? ""
                            }
                            onChange={value =>
                              setFormFieldValue(field.key, value)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="aiflow-type-body font-semibold text-foreground">
                  审批决定
                </p>
                <p className="aiflow-type-body mt-1 text-muted-foreground">
                  仅展示当前操作合同允许的结果，提交后由服务端选择唯一后继分支。
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {configuredOutcomes.map(item => (
                    <Button
                      key={item.code}
                      type="button"
                      variant={outcome === item.code ? "default" : "outline"}
                      className={`min-h-11 ${outcome === item.code ? (item.code === "approved" ? "bg-emerald-600 hover:bg-emerald-500" : item.code === "abstained" ? "bg-slate-600 hover:bg-slate-500" : "bg-red-600 hover:bg-red-500") : ""}`}
                      onClick={() => setOutcome(item.code)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
                <label className="mt-3 grid gap-1 text-sm font-medium text-foreground">
                  处理意见{commentRequired ? "（必填）" : "（可选）"}
                  <textarea
                    className="min-h-20 resize-y rounded border border-border bg-card px-3 py-2 text-sm font-normal outline-none focus:border-blue-400"
                    maxLength={2000}
                    value={comment}
                    onChange={event => setComment(event.target.value)}
                    placeholder={
                      commentRequired
                        ? "请说明拒绝原因"
                        : decision === "abstained"
                          ? "可说明弃权原因"
                          : "可填写审批意见"
                    }
                  />
                </label>
                <details className="mt-3 rounded border border-border bg-card/70 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    附加结果字段（可选）
                  </summary>
                  <div className="mt-3 grid gap-2">
                    {resultRows.map((row, index) => (
                      <div
                        key={index}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                      >
                        <input
                          className="col-span-2 h-9 min-w-0 rounded border border-border bg-card px-2 text-sm sm:col-span-1"
                          aria-label="处理结果字段名称"
                          placeholder="字段名"
                          value={row.key}
                          onChange={event =>
                            updateRow(index, "key", event.target.value)
                          }
                        />
                        <input
                          className="h-9 min-w-0 rounded border border-border bg-card px-2 text-sm"
                          aria-label="处理结果字段值"
                          placeholder="字段值"
                          value={row.value}
                          onChange={event =>
                            updateRow(index, "value", event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="min-h-11 min-w-11 rounded px-2 text-muted-foreground hover:text-red-600"
                          onClick={() =>
                            setResultRows(rows =>
                              rows.filter((_, rowIndex) => rowIndex !== index)
                            )
                          }
                          aria-label="删除处理结果字段"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="w-fit text-xs font-medium text-aiflow-info hover:underline"
                      onClick={() =>
                        setResultRows(rows => [...rows, { key: "", value: "" }])
                      }
                    >
                      + 添加处理结果字段
                    </button>
                  </div>
                </details>
                <Button
                  className={`mt-3 min-h-11 w-full ${decision === "rejected" ? "bg-red-600 hover:bg-red-500" : decision === "abstained" ? "bg-slate-600 hover:bg-slate-500" : "bg-emerald-600 hover:bg-emerald-500"}`}
                  disabled={
                    busy ||
                    missingRequiredFormField ||
                    (commentRequired && !comment.trim())
                  }
                  onClick={submitResult}
                >
                  {busy && <Loader2 className="animate-spin" size={15} />}
                  {`提交${selectedOutcome?.label ?? task.operationName ?? "操作结果"}`}
                </Button>
                {task.status === "pending" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 min-h-11 w-full"
                    disabled={busy}
                    onClick={onClaim}
                  >
                    仅领取，稍后处理
                  </Button>
                )}
              </div>
            )}
            {task.status === "completed" && (
              <div>
                <p className="aiflow-type-body font-semibold text-muted-foreground">
                  处理结果
                </p>
                <pre className="aiflow-type-code mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 font-mono text-emerald-200">
                  {JSON.stringify(task.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
