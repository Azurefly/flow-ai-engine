import { Button } from "@/components/ui/button";
import { ProcessWorkbenchRunTab } from "@/components/ProcessWorkbenchRunTab";
import { trpc } from "@/lib/trpc";
import {
  CalendarDays,
  CheckCheck,
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

function date(value: unknown) {
  return value
    ? new Date(String(value)).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function badge(status: string) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    claimed: "bg-blue-100 text-blue-700",
    completed: "bg-emerald-100 text-emerald-700",
    success: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    running: "bg-blue-100 text-blue-700",
    等待审核: "bg-amber-100 text-amber-700",
    待审批: "bg-amber-100 text-amber-700",
    已审核: "bg-blue-100 text-blue-700",
    "直接上级审核通过，待经理通过": "bg-indigo-100 text-indigo-700",
    申请通过: "bg-emerald-100 text-emerald-700",
  };
  const names: Record<string, string> = {
    pending: "待处理",
    claimed: "处理中",
    completed: "已办",
    cancelled: "已取消",
    success: "成功",
    failed: "失败",
    running: "等待任务",
    queued: "排队中",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${styles[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {names[status] ?? status}
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
  const [batchDecision, setBatchDecision] = useState<
    "approved" | "rejected" | "abstained"
  >("approved");
  const [batchComment, setBatchComment] = useState("");
  const [month, setMonth] = useState(() => new Date());
  const dashboard = trpc.task.dashboard.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const taskInput = useMemo(
    () => ({
      view: view === "board" || view === "calendar" ? ("todo" as const) : view,
      limit: 100,
    }),
    [view]
  );
  const tasks = trpc.task.list.useQuery(taskInput, {
    enabled: ["todo", "done"].includes(view),
    refetchInterval: 10_000,
  });
  const instanceInput = useMemo(
    () => ({
      view: view === "initiated" ? ("initiated" as const) : ("all" as const),
      limit: 100,
    }),
    [view]
  );
  const instances = trpc.task.instances.useQuery(instanceInput, {
    enabled: ["initiated", "all"].includes(view),
    refetchInterval: 10_000,
  });
  const calendar = trpc.task.calendar.useQuery(
    { month },
    { enabled: view === "calendar" }
  );
  const taskDetail = trpc.task.get.useQuery(
    { taskId: selectedTaskId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(selectedTaskId), retry: false }
  );
  const assignees = trpc.task.assignees.useQuery(
    { taskId: selectedTaskId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(selectedTaskId), retry: false }
  );
  const invalidate = () => {
    void utils.task.dashboard.invalidate();
    void utils.task.list.invalidate();
    void utils.task.instances.invalidate();
    void utils.task.calendar.invalidate();
    if (selectedTaskId) {
      void utils.task.get.invalidate({ taskId: selectedTaskId });
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
      invalidate();
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
      invalidate();
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
      setSelectedTaskId(null);
    },
    onError: error => toast.error(error.message),
  });
  const handover = trpc.task.handover.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("人工任务已移交，已恢复为指定处理人的待办。");
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
      invalidate();
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
    invalidate();
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
    <div className="min-h-[calc(100vh-56px)] bg-[#f5f7fb] p-4 sm:p-6">
      <div
        className={`mx-auto grid max-w-[1500px] gap-4 ${sidebarCollapsed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[230px_minmax(0,1fr)]"}`}
      >
        <aside className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <div
            className={`border-b border-slate-100 px-3 py-3 ${sidebarCollapsed ? "flex justify-center" : ""}`}
          >
            <div className={sidebarCollapsed ? "hidden" : ""}>
              <p className="text-[10px] font-bold tracking-[.16em] text-[#5b72a8]">
                INITIATED PROCESS
              </p>
              <h1 className="mt-1 text-base font-semibold text-slate-800">
                已启动流程
              </h1>
            </div>
            <button
              type="button"
              aria-label={
                sidebarCollapsed ? "展开已启动流程导航" : "收起已启动流程导航"
              }
              title={sidebarCollapsed ? "展开导航" : "收起导航"}
              className={`min-h-11 min-w-11 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 ${sidebarCollapsed ? "" : "absolute hidden lg:block"}`}
              onClick={() => setSidebarCollapsed(value => !value)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
            <button
              type="button"
              aria-label="移动端切换已启动流程导航"
              title="切换导航"
              className="mt-2 min-h-11 min-w-11 rounded p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setSidebarCollapsed(value => !value)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
          </div>
          <nav className="mt-2 grid gap-1">
            {nav.map(item => (
              <button
                key={item.id}
                type="button"
                aria-label={labels[item.id]}
                aria-current={view === item.id ? "page" : undefined}
                title={sidebarCollapsed ? labels[item.id] : undefined}
                onClick={() => changeView(item.id)}
                className={`flex min-h-11 rounded px-3 py-2.5 text-left text-sm transition-colors ${sidebarCollapsed ? "justify-center" : "items-center gap-2"} ${view === item.id ? "bg-[#eaf1ff] font-semibold text-[#245fc8]" : "text-slate-600 hover:bg-slate-50"}`}
              >
                <item.icon size={16} />
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1">{labels[item.id]}</span>
                    {item.count !== null && (
                      <span className="rounded bg-white px-1.5 text-[10px] text-slate-500">
                        {item.count ?? 0}
                      </span>
                    )}
                  </>
                )}
              </button>
            ))}
          </nav>
          {!sidebarCollapsed && (
            <div className="mt-4 border-t border-slate-100 p-3 text-xs leading-5 text-slate-500">
              人工操作由服务端暂停和续跑；移交、退回与批量处理逐项执行，任务仅在当前流程授权范围内可见。
            </div>
          )}
        </aside>
        <main className="min-w-0">
          {selectedRunId ? (
            <ProcessWorkbenchRunTab
              runId={selectedRunId}
              baseTabLabel={labels[view]}
              onClose={closeRunTab}
              onReturn={closeRunTab}
            />
          ) : (
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <header className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-bold tracking-[.16em] text-[#5b72a8]">
                    PROCESS WORKBENCH
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-800">
                    {labels[view]}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    当前视图仅展示具备运行权限的流程实例与人工任务。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={invalidate}
                >
                  <RefreshCw size={14} />
                  刷新
                </Button>
              </header>
              {view === "board" && (
                <Board
                  dashboard={dashboard.data}
                  onTask={id => {
                    setView("todo");
                    setSelectedTaskId(id);
                  }}
                />
              )}
              {view === "calendar" && (
                <Calendar
                  month={month}
                  setMonth={setMonth}
                  events={(calendar.data ?? []) as any[]}
                  onTask={id => {
                    setView("todo");
                    setSelectedTaskId(id);
                  }}
                />
              )}
              {view === "todo" && (
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
              {["todo", "done"].includes(view) && (
                <TaskList
                  tasks={(tasks.data ?? []) as any[]}
                  loading={tasks.isLoading}
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
                />
              )}
              {["initiated", "all"].includes(view) && (
                <InstanceList
                  instances={(instances.data ?? []) as any[]}
                  loading={instances.isLoading}
                  onOpenRun={setSelectedRunId}
                />
              )}
            </section>
          )}
        </main>
      </div>
      {selectedTaskId && (
        <TaskDrawer
          task={taskDetail.data as any}
          assignees={(assignees.data ?? []) as any[]}
          busy={busy}
          onClose={() => setSelectedTaskId(null)}
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
    <div className="grid gap-3 border-b border-slate-100 bg-slate-50 px-3 py-3 sm:px-5 lg:grid-cols-[minmax(220px,1fr)_minmax(320px,1.4fr)_auto] lg:items-end">
      <div className="text-xs leading-5 text-slate-500">
        已选择 <strong className="text-slate-800">{count}</strong>{" "}
        项。批量处理对每项分别进行权限与状态校验，不会跨流程或跨项目执行。
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[130px_minmax(0,1fr)]">
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          批量决定
          <select
            className="h-11 rounded border border-slate-200 bg-white px-2 text-sm"
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
        <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-600">
          处理意见{decision === "rejected" ? "（必填）" : "（可选）"}
          <input
            className="h-11 min-w-0 rounded border border-slate-200 bg-white px-3 text-sm font-normal"
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
  onTask,
}: {
  dashboard: any;
  onTask: (id: string) => void;
}) {
  if (!dashboard)
    return (
      <div
        data-process-workbench-loading
        role="status"
        aria-live="polite"
        className="grid min-h-[360px] place-items-center p-6 text-center"
      >
        <div>
          <Loader2 className="mx-auto animate-spin text-[#2d6bea]" size={24} />
          <p className="mt-3 text-sm font-medium text-slate-700">
            正在读取已启动流程
          </p>
          <p className="mt-1 text-xs text-slate-500">
            正在加载当前授权范围内的看板统计与最近任务…
          </p>
        </div>
      </div>
    );
  const counts = dashboard?.counts ?? {};
  return (
    <div className="p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={ListTodo}
          label="待办"
          value={counts.todo ?? 0}
          tone="amber"
        />
        <Stat
          icon={CheckCheck}
          label="已办"
          value={counts.done ?? 0}
          tone="emerald"
        />
        <Stat
          icon={Send}
          label="我发起"
          value={counts.initiated ?? 0}
          tone="blue"
        />
        <Stat
          icon={UsersRound}
          label="全部可见"
          value={counts.all ?? 0}
          tone="slate"
        />
      </div>
      <section className="mt-5 overflow-hidden rounded-lg border border-slate-200">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          最近任务
        </div>
        <div className="divide-y divide-slate-100">
          {(dashboard?.recent ?? []).map((task: any) => (
            <button
              key={task.id}
              onClick={() => onTask(task.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <CirclePlay size={15} className="text-[#2d6bea]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">
                  {task.workflowName} · {task.nodeName}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {date(task.createdAt)} · {task.initiatedByName || "内部用户"}
                </p>
              </div>
              {badge(task.status)}
            </button>
          ))}
          {!(dashboard?.recent ?? []).length && (
            <p className="p-8 text-center text-sm text-slate-400">
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
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    slate: "bg-slate-50 text-slate-700",
  };
  return (
    <div className={`rounded-lg border border-slate-100 p-4 ${colors[tone]}`}>
      <div className="flex items-center justify-between text-xs font-medium">
        <span>{label}</span>
        <Icon size={15} />
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function TaskList({
  tasks,
  loading,
  onTask,
  onExecute,
  busy,
  selectedTaskIds,
  onToggle,
  selectable,
}: {
  tasks: any[];
  loading: boolean;
  onTask: (id: string) => void;
  onExecute: (id: string) => void;
  busy: boolean;
  selectedTaskIds: string[];
  onToggle: (id: string) => void;
  selectable: boolean;
}) {
  return (
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
      {loading ? (
        <Loading colSpan={selectable ? 6 : 5} />
      ) : (
        tasks.map(task => (
          <tr key={task.id} className="border-t border-slate-100">
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
              <p className="font-medium text-slate-800">{task.workflowName}</p>
              <p className="mt-1 text-xs text-slate-400">
                {task.nodeName}
                {approvalLabel(task) && (
                  <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">
                    {approvalProgressText(task)}
                  </span>
                )}
              </p>
            </td>
            <td className="px-4 py-3 text-xs text-slate-500">
              {task.initiatedByName || "—"}
            </td>
            <td className="px-4 py-3">
              {badge(task.displayStatus || task.status)}
            </td>
            <td className="px-4 py-3 text-xs text-slate-400">
              {date(task.createdAt)}
            </td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-1">
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
                  className="min-h-11 text-xs text-[#2d6bea]"
                  onClick={() => onTask(task.id)}
                >
                  详情
                </Button>
              </div>
            </td>
          </tr>
        ))
      )}
    </Table>
  );
}

function InstanceList({
  instances,
  loading,
  onOpenRun,
}: {
  instances: any[];
  loading: boolean;
  onOpenRun: (id: string) => void;
}) {
  return (
    <Table headers={["流程实例", "发起人", "状态", "创建时间", "操作"]}>
      {loading ? (
        <Loading />
      ) : (
        instances.map(run => (
          <tr key={run.id} className="border-t border-slate-100">
            <td className="px-4 py-3">
              <p className="font-medium text-slate-800">{run.workflowName}</p>
              <code className="mt-1 block text-[10px] text-slate-400">
                {run.id.slice(0, 8)}
              </code>
            </td>
            <td className="px-4 py-3 text-xs text-slate-500">
              {run.initiatedByName || "—"}
            </td>
            <td className="px-4 py-3">
              {badge(run.displayStatus || run.status)}
            </td>
            <td className="px-4 py-3 text-xs text-slate-400">
              {date(run.createdAt)}
            </td>
            <td className="px-4 py-3">
              <div className="flex flex-col items-start gap-1">
                {!(run.availableOperations ?? []).length && (
                  <span className="text-[10px] text-slate-400">
                    无可执行操作
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 px-2 text-xs text-[#2d6bea]"
                  onClick={() => onOpenRun(run.id)}
                >
                  实例详情
                </Button>
              </div>
            </td>
          </tr>
        ))
      )}
    </Table>
  );
}

function Table({
  children,
  headers = ["流程 / 任务", "发起人", "状态", "创建时间", "操作"],
}: {
  children: React.ReactNode;
  headers?: string[];
}) {
  return (
    <div className="overflow-x-auto p-5">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
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
        <Loader2 className="mx-auto animate-spin text-slate-400" size={18} />
      </td>
    </tr>
  );
}

function Calendar({
  month,
  setMonth,
  events,
  onTask,
}: {
  month: Date;
  setMonth: (date: Date) => void;
  events: any[];
  onTask: (id: string) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return value;
  });
  const eventDay = (day: Date) =>
    events.filter(
      event =>
        new Date(String(event.start)).toDateString() === day.toDateString()
    );
  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          上月
        </Button>
        <p className="font-semibold text-slate-700">
          {month.getFullYear()} 年 {month.getMonth() + 1} 月
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          下月
        </Button>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-slate-200 text-xs">
        {"日一二三四五六".split("").map(day => (
          <div
            key={day}
            className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-medium text-slate-500"
          >
            {day}
          </div>
        ))}
        {days.map(day => (
          <div
            key={day.toISOString()}
            className={`min-h-24 border-b border-r border-slate-200 p-2 ${day.getMonth() !== month.getMonth() ? "bg-slate-50 text-slate-300" : "bg-white"}`}
          >
            <p>{day.getDate()}</p>
            <div className="mt-1 grid gap-1">
              {eventDay(day).map(event => (
                <button
                  key={event.id}
                  onClick={() => onTask(event.id)}
                  className="truncate rounded bg-blue-50 px-1 py-0.5 text-left text-[10px] text-blue-700"
                >
                  {event.title}
                </button>
              ))}
            </div>
          </div>
        ))}
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

function TaskDrawer({
  task,
  assignees,
  busy,
  onClose,
  onClaim,
  onExecute,
  onComplete,
  onHandover,
  onReturn,
}: any) {
  const [targetUserId, setTargetUserId] = useState("");
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
            row.key.trim() && !["decision", "comment"].includes(row.key.trim())
        )
        .map(row => [row.key, toValue(row.value)])
    ),
    decision,
    outcome: selectedOutcome?.code ?? decision,
    ...(comment.trim() ? { comment: comment.trim() } : {}),
  });
  const canManage = task?.status === "pending" || task?.status === "claimed";
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
      <section className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <p className="text-[10px] font-bold tracking-[.16em] text-[#5b72a8]">
              MANUAL TASK
            </p>
            <h3
              id="workflow-task-drawer-title"
              className="mt-1 text-lg font-semibold text-slate-800"
            >
              {task?.workflowName || "正在读取任务…"}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {task?.nodeName}
              {approvalLabel(task) && (
                <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">
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
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">操作说明</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                {task.instruction || "请完成当前人工操作。"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {badge(task.displayStatus || task.status)}
                <span className="text-xs text-slate-400">
                  创建于 {date(task.createdAt)}
                </span>
                {task.assignedName && (
                  <span className="text-xs text-slate-400">
                    指定处理人：{task.assignedName}
                  </span>
                )}
              </div>
            </div>
            {canManage && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                <p className="text-xs font-semibold text-slate-600">
                  任务移交与回退
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  仅显示拥有该流程运行权限的内部用户。移交或退回不会推进流程，仍由服务端保留等待状态。
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <select
                    aria-label="选择移交处理人"
                    value={targetUserId}
                    onChange={event => setTargetUserId(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-sm"
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
                </div>
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
            {(task.status === "pending" || task.status === "claimed") && (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-4">
                <p className="text-xs font-semibold text-slate-600">审批决定</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
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
                <label className="mt-3 grid gap-1 text-xs font-medium text-slate-600">
                  处理意见{commentRequired ? "（必填）" : "（可选）"}
                  <textarea
                    className="min-h-20 resize-y rounded border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-blue-400"
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
                <details className="mt-3 rounded border border-slate-200 bg-white/70 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">
                    附加结果字段（可选）
                  </summary>
                  <div className="mt-3 grid gap-2">
                    {resultRows.map((row, index) => (
                      <div
                        key={index}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                      >
                        <input
                          className="col-span-2 h-9 min-w-0 rounded border border-slate-200 bg-white px-2 text-sm sm:col-span-1"
                          aria-label="处理结果字段名称"
                          placeholder="字段名"
                          value={row.key}
                          onChange={event =>
                            updateRow(index, "key", event.target.value)
                          }
                        />
                        <input
                          className="h-9 min-w-0 rounded border border-slate-200 bg-white px-2 text-sm"
                          aria-label="处理结果字段值"
                          placeholder="字段值"
                          value={row.value}
                          onChange={event =>
                            updateRow(index, "value", event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="min-h-11 min-w-11 rounded px-2 text-slate-400 hover:text-red-600"
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
                      className="w-fit text-xs font-medium text-[#245fc8] hover:underline"
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
                    busy || (commentRequired && !comment.trim())
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
                <p className="text-xs font-semibold text-slate-500">处理结果</p>
                <pre className="mt-2 rounded bg-slate-950 p-3 text-xs text-emerald-200">
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
