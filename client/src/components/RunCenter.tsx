import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Square,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function formatTime(value: unknown) {
  return value
    ? new Date(String(value)).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function decodeJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const runStatusLabels: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  waiting: "等待人工",
  blocked: "已暂停",
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
  terminated: "已终止",
};

function runStatusLabel(status: unknown) {
  const value = String(status || "unknown");
  return runStatusLabels[value] ?? value;
}

function runStatusClass(status: unknown) {
  const value = String(status || "unknown");
  if (value === "success") return "bg-emerald-100 text-emerald-700";
  if (value === "failed" || value === "terminated") return "bg-red-100 text-red-700";
  if (value === "cancelled") return "bg-slate-100 text-slate-600";
  if (value === "blocked") return "bg-orange-100 text-orange-700";
  return "bg-amber-100 text-amber-700";
}

function runDuration(value: unknown) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function LogBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="mb-1 font-semibold text-slate-500">{title}</p>
      <pre className="max-h-48 overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-emerald-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function QueryErrorNotice({
  title,
  onRetry,
}: {
  title: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <p className="text-sm font-medium text-rose-700">{title}</p>
      <p className="text-xs text-slate-500">服务端暂时未返回数据，请重试。</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>
        <RefreshCw size={14} />
        重试
      </Button>
    </div>
  );
}

function QueryLoadingNotice({ title }: { title: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-24 items-center justify-center gap-2 p-6 text-center text-sm text-slate-500"
    >
      <Loader2 className="animate-spin text-slate-400" size={18} />
      {title}
    </div>
  );
}

export default function RunCenter({
  workflowId,
  workflowName,
  selectedRun,
  onSelect,
}: {
  workflowId: string | null;
  workflowName?: string | null;
  selectedRun: any;
  onSelect: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<
    | ""
    | "queued"
    | "running"
    | "waiting"
    | "blocked"
    | "success"
    | "failed"
    | "cancelled"
    | "terminated"
  >("");
  const [range, setRange] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [triggeredBy, setTriggeredBy] = useState("");
  const filter = useMemo(() => {
    const now = Date.now();
    const rangeMs =
      range === "24h"
        ? 24 * 60 * 60 * 1000
        : range === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : range === "30d"
            ? 30 * 24 * 60 * 60 * 1000
            : undefined;
    return {
      workflowId: workflowId ?? "00000000",
      status: status || undefined,
      from: rangeMs ? new Date(now - rangeMs) : undefined,
      triggeredByUserId: triggeredBy ? Number(triggeredBy) : undefined,
    };
  }, [range, status, triggeredBy, workflowId]);
  const runs = trpc.workflow.runs.useQuery(filter, {
    enabled: Boolean(workflowId),
    refetchInterval: 5_000,
    retry: false,
  });
  const metrics = trpc.workflow.runMetrics.useQuery(filter, {
    enabled: Boolean(workflowId),
    refetchInterval: 5_000,
    retry: false,
  });
  const alerts = trpc.workflow.alerts.useQuery(undefined, {
    enabled: Boolean(workflowId),
    refetchInterval: 10_000,
    retry: false,
  });
  const markRead = trpc.workflow.markAlertRead.useMutation({
    onSuccess: () => {
      void utils.workflow.alerts.invalidate();
      toast.success("告警已标记为已读。");
    },
    onError: error => toast.error(error.message),
  });
  const cancelRun = trpc.workflow.cancelRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runDetail.invalidate();
      toast.success("取消运行命令已提交。");
    },
    onError: error => toast.error(error.message),
  });
  const terminateRun = trpc.workflow.terminateRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runDetail.invalidate();
      toast.success("终止运行命令已提交。");
    },
    onError: error => toast.error(error.message),
  });
  const pauseRun = trpc.workflow.pauseRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runDetail.invalidate();
      toast.success("暂停运行命令已提交，将在安全检查点生效。");
    },
    onError: error => toast.error(error.message),
  });
  const resumeRun = trpc.workflow.resumeRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runDetail.invalidate();
      toast.success("恢复运行命令已提交。");
    },
    onError: error => toast.error(error.message),
  });
  const workflowAlerts = (alerts.data ?? []).filter(
    (alert: any) => alert.workflowId === workflowId
  );
  const controlPending =
    cancelRun.isPending ||
    terminateRun.isPending ||
    pauseRun.isPending ||
    resumeRun.isPending;
  const refreshAll = () => {
    void runs.refetch();
    void metrics.refetch();
    void alerts.refetch();
    void utils.workflow.runDetail.invalidate();
  };

  if (!workflowId)
    return (
      <div className="grid min-h-[calc(100vh-56px)] place-items-center p-8 text-center text-sm text-slate-400">
        <div>
          <Clock3 className="mx-auto" size={30} />
          <p className="mt-3">请先在流程仓库选择一个可查看的流程。</p>
        </div>
      </div>
    );

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div
        data-aiflow-context-header
        className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
      >
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[.18em] text-blue-600">
            RUNTIME OBSERVABILITY
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            运行分析、失败告警与节点日志
          </h2>
          <p className="mt-1 truncate text-xs text-slate-500">
            当前流程：{workflowName || "未命名流程"} · {workflowId.slice(0, 8)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">
            当前流程范围 · 自动刷新 5 秒
          </span>
    <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={refreshAll}
            disabled={
              runs.isFetching || metrics.isFetching || alerts.isFetching || controlPending
            }
          >
            <RefreshCw
              size={14}
              className={runs.isFetching ? "animate-spin" : undefined}
            />
            刷新
          </Button>
        </div>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={15} className="shrink-0 text-slate-500" />
          <select
            aria-label="按运行状态筛选"
            className="h-9 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs sm:flex-none"
            value={status}
            onChange={event => setStatus(event.target.value as typeof status)}
          >
            <option value="">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
            <option value="running">运行中</option>
            <option value="waiting">等待人工</option>
            <option value="blocked">已暂停</option>
            <option value="queued">排队中</option>
            <option value="cancelled">已取消</option>
            <option value="terminated">已终止</option>
          </select>
          <select
            aria-label="按时间筛选"
            className="h-9 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs sm:flex-none"
            value={range}
            onChange={event => setRange(event.target.value as typeof range)}
          >
            <option value="all">全部时间</option>
            <option value="24h">最近 24 小时</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
          </select>
          <Input
            aria-label="按触发者筛选"
            className="h-9 w-full text-xs sm:w-36"
            inputMode="numeric"
            placeholder="触发者用户 ID"
            value={triggeredBy}
            onChange={event =>
              setTriggeredBy(event.target.value.replace(/\D/g, ""))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => {
              setStatus("");
              setRange("all");
              setTriggeredBy("");
            }}
          >
            清除筛选
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-1 text-[11px] leading-5 text-slate-400">
          <Search size={12} />
          运行中心严格限定在当前已选流程；触发者筛选使用用户 ID，不伪造跨流程聚合。
        </p>
      </section>
      <section
        aria-label="运行统计"
        className="rounded-lg border border-slate-200 bg-white shadow-sm"
      >
        {metrics.isError ? (
          <QueryErrorNotice
            title="运行统计读取失败"
            onRetry={() => void metrics.refetch()}
          />
        ) : metrics.isLoading || !metrics.data ? (
          <QueryLoadingNotice title="正在读取运行统计…" />
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="总运行"
              value={metrics.data.totalRuns}
              icon={BarChart3}
              tone="blue"
            />
            <MetricCard
              label="成功"
              value={metrics.data.successfulRuns}
              icon={CheckCircle2}
              tone="emerald"
            />
            <MetricCard
              label="失败"
              value={metrics.data.failedRuns}
              icon={XCircle}
              tone="red"
            />
            <MetricCard
              label="失败率"
              value={`${metrics.data.failureRate}%`}
              icon={AlertTriangle}
              tone="amber"
            />
            <MetricCard
              label="平均耗时"
              value={`${metrics.data.averageDurationMs} ms`}
              icon={Clock3}
              tone="slate"
            />
          </div>
        )}
      </section>
      <section className="overflow-hidden rounded-lg border border-red-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-red-100 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <AlertTriangle size={15} />
            失败告警
          </div>
          <span className="rounded bg-white px-2 py-0.5 text-[10px] text-red-700">
            {alerts.isError
              ? "读取失败"
              : alerts.isLoading || !alerts.data
                ? "读取中"
                : `${workflowAlerts.filter((alert: any) => !alert.readAt).length} 未读`}
          </span>
        </div>
        <div className="max-h-48 overflow-y-auto">
          {alerts.isError ? (
            <QueryErrorNotice
              title="失败告警读取失败"
              onRetry={() => void alerts.refetch()}
            />
          ) : alerts.isLoading || !alerts.data ? (
            <QueryLoadingNotice title="正在读取失败告警…" />
          ) : (
            workflowAlerts.map((alert: any) => (
              <div
                key={alert.id}
                className={`flex flex-col gap-2 border-b border-slate-100 px-4 py-3 text-xs sm:flex-row sm:items-center ${alert.readAt ? "text-slate-400" : "text-slate-700"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{alert.summary}</p>
                  <p className="mt-1 truncate">
                    {decodeJson(alert.detailsJson)?.message ||
                      "请查看运行节点日志。"}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {formatTime(alert.createdAt)} · {alert.durationMs ?? "—"} ms
                  </p>
                </div>
                {!alert.readAt && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate({ alertId: alert.id })}
                  >
                    标记已读
                  </Button>
                )}
              </div>
            ))
          )}
          {!alerts.isError && !alerts.isLoading && alerts.data && !workflowAlerts.length && (
            <p className="p-4 text-center text-xs text-slate-400">
              当前筛选范围内没有失败告警。
            </p>
          )}
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-sm font-semibold">
            <div className="flex items-center gap-2">
              <span>运行实例</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-normal text-slate-500">
                {runs.isError
                  ? "读取失败"
                  : runs.isLoading || !runs.data
                    ? "读取中"
                    : `${runs.data.length} 条`}
              </span>
            </div>
            {runs.isFetching && (
              <Loader2 className="animate-spin text-slate-400" size={14} />
            )}
          </div>
          {runs.isError ? (
            <QueryErrorNotice
              title="运行实例读取失败"
              onRetry={() => void runs.refetch()}
            />
          ) : runs.isLoading || !runs.data ? (
            <QueryLoadingNotice title="正在读取运行实例…" />
          ) : (
          <div className="overflow-x-auto">
            <table
              data-run-instance-table
              aria-label="当前流程运行实例表"
              className="w-full min-w-[860px] text-left text-sm"
            >
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">运行 ID</th>
                  <th className="px-4 py-3 font-medium">流程</th>
                  <th className="px-4 py-3 font-medium">触发人</th>
                  <th className="px-4 py-3 font-medium">开始时间</th>
                  <th className="px-4 py-3 font-medium">结束时间</th>
                  <th className="px-4 py-3 font-medium">耗时</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((run: any) => (
                  <tr
                    key={run.id}
                    className={`border-t border-slate-100 ${selectedRun?.id === run.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-4 py-3">
                      <code className="break-all text-xs text-slate-500">
                        {run.id}
                      </code>
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      <p className="truncate font-medium text-slate-800">
                        {run.workflowName || workflowName || "未命名流程"}
                      </p>
                      {run.businessKey && (
                        <p className="mt-1 truncate text-[10px] text-slate-400">
                          业务标识：{run.businessKey}
                        </p>
                      )}
                    </td>
                    <td className="max-w-[150px] truncate px-4 py-3 text-xs text-slate-500">
                      {run.triggeredByName ||
                        run.username ||
                        `用户 ${run.triggeredByUserId ?? "—"}`}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {formatTime(run.startedAt ?? run.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {formatTime(run.finishedAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {runDuration(run.durationMs)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${runStatusClass(run.status)}`}>
                        {runStatusLabel(run.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11 px-2 text-xs text-blue-700"
                        onClick={() => onSelect(run.id)}
                        aria-label={`查看运行实例 ${String(run.id).slice(0, 12)}`}
                      >
                        查看详情
                      </Button>
                    </td>
                  </tr>
                ))}
                {runs.isFetching && !(runs.data ?? []).length && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center">
                      <Loader2 className="mx-auto animate-spin text-slate-400" size={18} />
                    </td>
                  </tr>
                )}
                {!runs.isFetching && !(runs.data ?? []).length && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-sm text-slate-400">
                      当前筛选条件下尚无运行记录。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </section>
        <section className="min-h-80 rounded-lg border border-slate-200 bg-white p-5 xl:col-span-2">
          {selectedRun ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-[.18em] text-slate-400">
                    RUN {selectedRun.id.slice(0, 8)}
                  </p>
                  <h3 className="mt-1 font-semibold">
                    {selectedRun.status === "success"
                      ? "运行成功"
                      : `${runStatusLabel(selectedRun.status)} · 运行详情`}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span
                    aria-live="polite"
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${runStatusClass(selectedRun.status)}`}
                  >
                    {runStatusLabel(selectedRun.status)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {runDuration(selectedRun.durationMs)}
                  </span>
                  {["queued", "running", "waiting", "blocked"].includes(
                    String(selectedRun.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 text-xs text-blue-700"
                      disabled={controlPending}
                      onClick={() => {
                        if (selectedRun.status === "blocked") {
                          resumeRun.mutate({ runId: selectedRun.id });
                        } else if (
                          window.confirm(
                            "确定暂停这次流程运行吗？系统只会在已持久化 Checkpoint 边界暂停。"
                          )
                        ) {
                          pauseRun.mutate({ runId: selectedRun.id });
                        }
                      }}
                    >
                      {selectedRun.status === "blocked" ? (
                        <Play size={14} />
                      ) : (
                        <Pause size={14} />
                      )}
                      {selectedRun.status === "blocked" ? "恢复运行" : "暂停运行"}
                    </Button>
                  )}
                  {["queued", "running", "waiting", "blocked"].includes(
                    String(selectedRun.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 text-xs text-amber-700"
                      disabled={controlPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "确定取消这次流程运行吗？取消后将终止排队、节点租约和未完成人工任务。"
                          )
                        )
                          cancelRun.mutate({ runId: selectedRun.id });
                      }}
                    >
                      <Square size={13} />
                      取消运行
                    </Button>
                  )}
                  {["queued", "running", "waiting", "blocked"].includes(
                    String(selectedRun.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 text-xs text-red-700"
                      disabled={controlPending}
                      onClick={() => {
                        const reason = window.prompt(
                          "请输入终止原因（必填）",
                          "人工终止"
                        );
                        if (reason?.trim())
                          terminateRun.mutate({
                            runId: selectedRun.id,
                            reason: reason.trim(),
                          });
                      }}
                    >
                      <XCircle size={14} />
                      终止运行
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-3 flex items-start gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                <span>
                  暂停/恢复仅在已持久化 Checkpoint 边界生效；取消使用服务端标准命令，终止操作必须填写原因并写入运行控制记录。
                </span>
              </div>
              <div className="mt-5 grid gap-3" aria-label="节点执行日志">
                {(selectedRun.nodeRuns ?? []).map((node: any) => (
                  <details
                    key={node.id}
                    className="rounded border border-slate-200 bg-slate-50 p-3"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${node.status === "success" ? "bg-emerald-500" : node.status === "failed" ? "bg-red-500" : "bg-slate-400"}`}
                        />
                        {node.nodeName}
                        <code className="text-[10px] text-slate-400">
                          {node.nodeType}
                        </code>
                      </span>
                      <span className="text-xs text-slate-400">
                        {node.durationMs ?? "—"} ms
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 text-xs">
                      <LogBlock
                        title="输入"
                        value={decodeJson(node.inputJson)}
                      />
                      <LogBlock
                        title="输出"
                        value={decodeJson(node.outputJson)}
                      />
                      <LogBlock
                        title="错误"
                        value={decodeJson(node.errorJson)}
                      />
                    </div>
                  </details>
                ))}
                {!(selectedRun.nodeRuns ?? []).length && (
                  <p className="rounded border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                    当前实例尚无节点执行日志。
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-slate-400">
              <div>
                <Clock3 className="mx-auto" size={28} />
                <p className="mt-3">从左侧选择一次运行以查看节点级日志。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof BarChart3;
  tone: "blue" | "emerald" | "red" | "amber" | "slate";
}) {
  const tones = {
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    red: "border-red-100 bg-red-50 text-red-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between text-xs font-medium">
        <span>{label}</span>
        <Icon size={15} />
      </div>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}
