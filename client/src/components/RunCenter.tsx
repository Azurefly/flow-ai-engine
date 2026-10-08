import { nodeExecutionEntries } from "@shared/node-execution-entries";
import { workflowNodeTypeLabel } from "@shared/workflow-node-label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatRunDuration } from "@shared/run-duration";
import { runMonitorRefreshInterval } from "@shared/run-monitor-refresh";
import { RunApprovalProgress } from "./RunApprovalProgress";
import type { RunApprovalGroup } from "@shared/run-approval-progress";
import { formatRunStatus, runStatusSummary } from "@shared/run-status-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RunPayloadDetails } from "./RunPayloadDetails";

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

export default function RunCenter({
  workflowId,
  workflowName,
  selectedRunId,
  selectedRun,
  selectedRunLoading,
  selectedRunError,
  onSelect,
  onClearSelection,
  onRetrySelection,
}: {
  projectId?: string | null;
  workflowId: string | null;
  workflowName?: string | null;
  selectedRunId: string | null;
  selectedRun: any;
  selectedRunLoading: boolean;
  selectedRunError: boolean;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  onRetrySelection: () => void;
}) {
  const utils = trpc.useUtils();
  const [controlDialog, setControlDialog] = useState<{
    action: "pause" | "cancel" | "terminate";
    runId: string;
  } | null>(null);
  const [controlReason, setControlReason] = useState("");
  const [controlError, setControlError] = useState("");
  useEffect(() => {
    setControlDialog(null);
    setControlReason("");
    setControlError("");
  }, [workflowId, selectedRunId]);
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
  const [triggeredByInput, setTriggeredByInput] = useState("");
  const [triggeredByQuery, setTriggeredByQuery] = useState("");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [historyNavigation, setHistoryNavigation] = useState<{
    filterKey: string;
    cursors: Array<string | undefined>;
  }>({ filterKey: "", cursors: [undefined] });
  const runListRef = useRef<HTMLElement | null>(null);
  const runDetailRef = useRef<HTMLElement | null>(null);
  const previousSelectedRunId = useRef<string | null>(selectedRunId);
  const runDetail =
    selectedRunId && selectedRun?.id !== selectedRunId ? null : selectedRun;
  const nodeEntries = useMemo(
    () => nodeExecutionEntries<any>(runDetail?.nodeRuns ?? []),
    [runDetail?.nodeRuns]
  );
  const hasSelectedRun = Boolean(selectedRunId || runDetail);
  useEffect(() => {
    const activeRunId = selectedRunId ?? selectedRun?.id ?? null;
    let frame: number | undefined;
    if (activeRunId && window.matchMedia("(max-width: 1279px)").matches) {
      frame = window.requestAnimationFrame(() =>
        runDetailRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      );
    } else if (!activeRunId && previousSelectedRunId.current) {
      frame = window.requestAnimationFrame(() =>
        runListRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      );
    }
    previousSelectedRunId.current = activeRunId;
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [selectedRunId, selectedRun?.id]);
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setTriggeredByQuery(triggeredByInput.trim()),
      300
    );
    return () => window.clearTimeout(timeout);
  }, [triggeredByInput]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncWithViewport = () => setAdvancedFiltersOpen(media.matches);
    syncWithViewport();
    media.addEventListener("change", syncWithViewport);
    return () => media.removeEventListener("change", syncWithViewport);
  }, []);
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
      triggeredByQuery: triggeredByQuery || undefined,
    };
  }, [range, status, triggeredByQuery, workflowId]);
  const historyFilterKey = JSON.stringify([
    workflowId,
    status,
    range,
    triggeredByQuery,
  ]);
  const historyCursorStack =
    historyNavigation.filterKey === historyFilterKey
      ? historyNavigation.cursors
      : [undefined];
  const historyCursor = historyCursorStack.at(-1);
  const metrics = trpc.workflow.runMetrics.useQuery(filter, {
    enabled: Boolean(workflowId),
    refetchInterval: query =>
      runMonitorRefreshInterval({
        enabled: autoRefreshEnabled,
        ...query.state.data,
        selectedStatus: runDetail?.status,
        queryFailed: Boolean(query.state.error),
      }),
    refetchIntervalInBackground: false,
  });
  const refreshInterval = runMonitorRefreshInterval({
    enabled: autoRefreshEnabled,
    ...metrics.data,
    selectedStatus: runDetail?.status,
  });
  const runs = trpc.workflow.runHistoryPage.useQuery(
    { ...filter, cursor: historyCursor, pageSize: 10 },
    {
      enabled: Boolean(workflowId),
      refetchInterval: query => (query.state.error ? false : refreshInterval),
      refetchIntervalInBackground: false,
    }
  );
  const alerts = trpc.workflow.alerts.useQuery(filter, {
    enabled: Boolean(workflowId),
    refetchInterval: query => (query.state.error ? false : refreshInterval),
    refetchIntervalInBackground: false,
  });
  const markRead = trpc.workflow.markAlertRead.useMutation({
    onSuccess: () => void utils.workflow.alerts.invalidate(),
  });
  const cancelRun = trpc.workflow.cancelRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runHistoryPage.invalidate();
      void utils.workflow.runDetail.invalidate();
      if (workflowId) void utils.workflow.runMetrics.invalidate({ workflowId });
    },
    onError: error => toast.error(error.message),
  });
  const terminateRun = trpc.workflow.terminateRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runHistoryPage.invalidate();
      void utils.workflow.runDetail.invalidate();
      if (workflowId) void utils.workflow.runMetrics.invalidate({ workflowId });
    },
    onError: error => toast.error(error.message),
  });
  const pauseRun = trpc.workflow.pauseRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runHistoryPage.invalidate();
      void utils.workflow.runDetail.invalidate();
      if (workflowId) void utils.workflow.runMetrics.invalidate({ workflowId });
    },
    onError: error => toast.error(error.message),
  });
  const resumeRun = trpc.workflow.resumeRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runHistoryPage.invalidate();
      void utils.workflow.runDetail.invalidate();
      if (workflowId) void utils.workflow.runMetrics.invalidate({ workflowId });
    },
    onError: error => toast.error(error.message),
  });
  const workflowAlerts = (alerts.data ?? []) as any[];
  const workflowRuns = runs.data?.items ?? [];
  const queryError =
    runs.error?.message || metrics.error?.message || alerts.error?.message;
  const queryLoading = runs.isLoading || metrics.isLoading || alerts.isLoading;
  const metricsUnavailable =
    metrics.isLoading || metrics.isError || !metrics.data;
  const failedMetricTone: "slate" | "red" | "emerald" = metricsUnavailable
    ? "slate"
    : metrics.data.failedRuns > 0
      ? "red"
      : metrics.data.totalRuns > 0
        ? "emerald"
        : "slate";
  const dataFetching =
    runs.isFetching || metrics.isFetching || alerts.isFetching;
  const latestUpdatedAt = Math.max(
    runs.dataUpdatedAt,
    metrics.dataUpdatedAt,
    alerts.dataUpdatedAt
  );
  const lastUpdatedLabel = latestUpdatedAt
    ? new Date(latestUpdatedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "尚无数据";
  const controlPending =
    cancelRun.isPending ||
    terminateRun.isPending ||
    pauseRun.isPending ||
    resumeRun.isPending;
  const hasRunFilters = Boolean(
    status || range !== "all" || triggeredByInput.trim() || triggeredByQuery
  );

  if (!workflowId)
    return (
      <div className="aiflow-type-body grid min-h-[calc(100vh-56px)] place-items-center p-8 text-center text-muted-foreground">
        <div>
          <Clock3 className="mx-auto" size={30} />
          <p className="mt-3">请先在流程仓库选择一个可查看的流程。</p>
        </div>
      </div>
    );

  return (
    <div className="min-w-0 space-y-5 p-4 lg:p-6">
      <div
        data-aiflow-context-header
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between"
      >
        <div className="min-w-0 lg:flex-1">
          <p className="aiflow-type-meta font-bold tracking-[.18em] text-aiflow-info">
            RUNTIME OBSERVABILITY
          </p>
          <h1
            data-aiflow-page-title=""
            className="aiflow-type-page-title mt-1 font-semibold"
          >
            运行分析、失败告警与节点日志
          </h1>
          <p className="aiflow-type-body mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-muted-foreground">
            <span className="shrink-0">当前流程：</span>
            <span
              className="min-w-0 max-w-full break-words font-medium text-foreground"
              aria-label={workflowName || "未命名流程"}
              title={workflowName || "未命名流程"}
            >
              {(workflowName || "未命名流程").replaceAll("_", "_\u200b")}
            </span>
            <code
              className="aiflow-type-meta shrink-0 font-mono text-muted-foreground"
              title={`流程编号：${workflowId}`}
            >
              · {workflowId.slice(0, 8)}
            </code>
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 lg:w-auto lg:flex-row lg:items-center">
          <div className="aiflow-type-meta text-muted-foreground">
            <p className="font-medium text-foreground">
              {refreshInterval
                ? `自动刷新 · 每 ${refreshInterval / 1000} 秒`
                : "自动刷新已暂停"}
            </p>
            <p aria-live="polite" className="mt-0.5">
              上次更新：{lastUpdatedLabel}
            </p>
          </div>
          <div className="flex min-w-0 flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="aiflow-type-control h-11 min-w-0 flex-1 px-2 sm:px-3 lg:h-9 lg:flex-none"
              aria-pressed={autoRefreshEnabled}
              onClick={() => setAutoRefreshEnabled(enabled => !enabled)}
            >
              {autoRefreshEnabled ? (
                <Pause size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              {autoRefreshEnabled ? "暂停自动刷新" : "恢复自动刷新"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="aiflow-type-control h-11 min-w-0 flex-1 px-2 sm:px-3 lg:h-9 lg:flex-none"
              disabled={dataFetching}
              onClick={() => {
                void Promise.all([
                  runs.refetch(),
                  metrics.refetch(),
                  alerts.refetch(),
                ]);
              }}
            >
              <RotateCcw
                size={14}
                className={dataFetching ? "animate-spin" : undefined}
                aria-hidden="true"
              />
              立即刷新
            </Button>
          </div>
        </div>
      </div>
      <section
        data-run-filter-panel=""
        className="rounded-lg border border-border bg-card p-3 shadow-sm sm:p-4"
      >
        <div className="grid min-w-0 grid-cols-2 items-center gap-2 lg:grid-cols-[minmax(180px,1fr)_minmax(160px,0.9fr)_minmax(220px,1.2fr)_auto]">
          <select
            aria-label="按运行状态筛选"
            className="aiflow-type-control h-11 min-w-0 rounded border border-border bg-card px-2 lg:h-9"
            value={status}
            onChange={event => setStatus(event.target.value as typeof status)}
          >
            <option value="">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
            <option value="running">运行中</option>
            <option value="waiting">等待中</option>
            <option value="blocked">已阻塞</option>
            <option value="queued">排队中</option>
            <option value="cancelled">已取消</option>
            <option value="terminated">已终止</option>
          </select>
          <select
            aria-label="按时间筛选"
            className="aiflow-type-control h-11 min-w-0 rounded border border-border bg-card px-2 lg:h-9"
            value={range}
            onChange={event => setRange(event.target.value as typeof range)}
          >
            <option value="all">全部时间</option>
            <option value="24h">最近 24 小时</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
          </select>
          <details
            open={advancedFiltersOpen}
            onToggle={event => setAdvancedFiltersOpen(event.currentTarget.open)}
            className="col-span-1 min-w-0 lg:contents"
          >
            <summary className="aiflow-type-control flex h-11 min-w-0 cursor-pointer list-none items-center justify-center gap-2 rounded border border-border px-2 text-center text-foreground lg:hidden">
              <Filter size={15} aria-hidden="true" />
              <span>更多筛选</span>
              {triggeredByQuery && (
                <span className="aiflow-type-meta rounded bg-aiflow-info-surface px-1.5 text-aiflow-info">
                  已启用
                </span>
              )}
            </summary>
            <div className="mt-2 min-w-0 lg:col-span-1 lg:mt-0">
              <label className="sr-only" htmlFor="run-triggered-by-filter">
                按触发者姓名或用户名筛选
              </label>
              <Input
                id="run-triggered-by-filter"
                aria-label="按触发者姓名或用户名筛选"
                className="aiflow-type-control h-11 min-w-0 w-full lg:h-9"
                placeholder="姓名或用户名"
                value={triggeredByInput}
                onChange={event => setTriggeredByInput(event.target.value)}
              />
            </div>
          </details>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="aiflow-type-control h-11 justify-self-end px-3 lg:col-span-1 lg:h-9"
            disabled={!hasRunFilters}
            onClick={() => {
              setStatus("");
              setRange("all");
              setTriggeredByInput("");
              setTriggeredByQuery("");
            }}
          >
            清除筛选
          </Button>
        </div>
      </section>
      {queryLoading && !queryError && (
        <div role="status" className="sr-only">
          正在读取运行分析数据…
        </div>
      )}
      {queryError && (
        <div
          role="alert"
          className="aiflow-type-body flex flex-wrap items-center justify-between gap-3 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-4 text-aiflow-danger"
        >
          <div>
            <p className="font-semibold">运行数据加载失败</p>
            <p className="aiflow-type-body mt-1 break-words text-aiflow-danger">
              {queryError}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 lg:h-9"
            onClick={() => {
              void runs.refetch();
              void metrics.refetch();
              void alerts.refetch();
            }}
          >
            <RotateCcw size={14} />
            重试
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <MetricCard
          label="运行数"
          value={metricsUnavailable ? "—" : metrics.data.totalRuns}
          icon={BarChart3}
          tone="blue"
        />
        <MetricCard
          label="失败"
          value={metricsUnavailable ? "—" : metrics.data.failedRuns}
          icon={XCircle}
          tone={failedMetricTone}
        />
        <MetricCard
          label="成功/失败平均耗时"
          value={
            metricsUnavailable
              ? "—"
              : formatRunDuration(metrics.data.averageDurationMs)
          }
          icon={Clock3}
          tone="slate"
          fullWidthOnMobile
        />
      </div>
      <details className="aiflow-type-body rounded-lg border border-border bg-card px-3 py-2 text-muted-foreground">
        <summary className="aiflow-type-control min-h-7 cursor-pointer font-medium text-foreground">
          更多指标
        </summary>
        <p className="mt-2 text-muted-foreground">
          执行中：{metricsUnavailable ? "—" : metrics.data.executingRuns} ·
          等待/暂停：{metricsUnavailable ? "—" : metrics.data.waitingRuns}
        </p>
        <p className="mt-2 text-muted-foreground">
          平均耗时仅统计有耗时记录的成功、失败运行；取消和终止不计入。当前样本：
          {metricsUnavailable ? "—" : metrics.data.durationSamples} 条。
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2">
          <span>
            成功：{metricsUnavailable ? "—" : metrics.data.successfulRuns}
          </span>
          <span>
            失败率：{metricsUnavailable ? "—" : `${metrics.data.failureRate}%`}
          </span>
        </div>
      </details>
      {workflowAlerts.length === 0 && !alerts.isLoading ? (
        <div className="aiflow-type-body flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-2.5 text-muted-foreground shadow-2xs">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <CheckCircle2 size={14} className="text-aiflow-success" />
            <span className="font-medium text-foreground">失败告警</span>
            <span className="text-muted-foreground">
              当前筛选范围内无告警记录
            </span>
          </div>
          <span className="aiflow-type-meta font-mono text-muted-foreground">
            0 未读
          </span>
        </div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-red-100 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-red-100 bg-red-50 px-4 py-3">
            <div className="aiflow-type-section-title flex items-center gap-2 font-semibold text-red-900">
              <AlertTriangle size={15} />
              失败告警
            </div>
            <span className="aiflow-type-meta rounded bg-card px-2 py-0.5 text-red-700">
              {workflowAlerts.filter((alert: any) => !alert.readAt).length} 未读
            </span>
          </div>
          <div>
            {alerts.isLoading ? (
              <p
                role="status"
                className="aiflow-type-body p-4 text-center text-muted-foreground"
              >
                正在读取失败告警…
              </p>
            ) : (
              workflowAlerts.map((alert: any) => (
                <div
                  key={alert.id}
                  className={`aiflow-type-body flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center ${alert.readAt ? "text-muted-foreground" : "text-foreground"}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{alert.summary}</p>
                    <p className="mt-1 break-words">
                      {decodeJson(alert.detailsJson)?.message ||
                        "请查看运行节点日志。"}
                    </p>
                    <p className="aiflow-type-meta mt-1 text-muted-foreground">
                      {formatTime(alert.createdAt)} ·{" "}
                      {formatRunDuration(alert.durationMs)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="aiflow-type-control h-11 lg:h-9"
                      onClick={() => onSelect(String(alert.runId))}
                    >
                      查看运行
                    </Button>
                    {!alert.readAt && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="aiflow-type-control h-11 lg:h-9"
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate({ alertId: alert.id })}
                      >
                        标记已读
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
      <div
        className={`grid min-w-0 gap-4 ${hasSelectedRun ? "grid-cols-1 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        <section
          ref={runListRef}
          data-run-history-panel
          className={`min-w-0 overflow-hidden rounded-lg border border-border bg-card ${hasSelectedRun ? "hidden xl:block" : ""}`}
        >
          <div className="aiflow-type-section-title flex items-center justify-between border-b border-border px-4 py-3 font-semibold">
            <span>运行记录</span>
            {runs.isFetching && (
              <Loader2
                className="animate-spin text-muted-foreground"
                size={14}
              />
            )}
          </div>
          <div>
            {workflowRuns.map((run: any) => (
              <button
                key={run.id}
                onClick={() => onSelect(run.id)}
                className={`w-full border-b border-border p-4 text-left hover:bg-muted ${selectedRun?.id === run.id || selectedRunId === run.id ? "bg-aiflow-info-surface" : ""}`}
              >
                <div className="flex justify-between gap-2">
                  <code className="aiflow-type-code font-mono text-muted-foreground">
                    {run.id.slice(0, 8)}
                  </code>
                  <span
                    className={`aiflow-type-meta rounded px-1.5 py-0.5 font-medium border ${run.status === "success" ? "bg-aiflow-success-surface text-aiflow-success border-aiflow-success-border" : run.status === "failed" ? "bg-red-50 text-red-700 border-red-200" : "bg-aiflow-warning-surface text-aiflow-warning border-aiflow-warning-border"}`}
                  >
                    {formatRunStatus(run.status)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground">
                  <span className="aiflow-type-meta font-mono tabular-nums">
                    {formatTime(run.createdAt)}
                  </span>
                  <span className="aiflow-type-meta font-mono tabular-nums">
                    {formatRunDuration(run.durationMs)}
                  </span>
                  <span className="aiflow-type-body min-w-0 break-words">
                    {run.triggeredByName ||
                      run.username ||
                      `用户 ${run.triggeredByUserId ?? "—"}`}
                  </span>
                </div>
              </button>
            ))}
            {!runs.isFetching && !workflowRuns.length && (
              <p className="aiflow-type-body p-6 text-center text-muted-foreground">
                当前筛选条件下尚无运行记录。
              </p>
            )}
          </div>
          <div className="aiflow-type-control flex flex-col gap-2 border-t border-border px-4 py-3 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span aria-live="polite">
              第 {historyCursorStack.length} 页 · 本页 {workflowRuns.length} 条
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 flex-1 lg:h-9 lg:flex-none"
                disabled={historyCursorStack.length <= 1 || runs.isFetching}
                onClick={() =>
                  setHistoryNavigation({
                    filterKey: historyFilterKey,
                    cursors: historyCursorStack.slice(0, -1),
                  })
                }
              >
                较新记录
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 flex-1 lg:h-9 lg:flex-none"
                disabled={!runs.data?.nextCursor || runs.isFetching}
                onClick={() => {
                  const nextCursor = runs.data?.nextCursor;
                  if (nextCursor)
                    setHistoryNavigation({
                      filterKey: historyFilterKey,
                      cursors: [...historyCursorStack, nextCursor],
                    });
                }}
              >
                更早记录
              </Button>
            </div>
          </div>
        </section>
        {hasSelectedRun && (
          <section
            ref={runDetailRef}
            data-run-detail-panel
            className="min-w-0 scroll-mt-4 rounded-lg border border-border bg-card p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="aiflow-type-meta font-bold tracking-[.18em] text-muted-foreground">
                  RUN {(selectedRunId ?? runDetail?.id ?? "").slice(0, 8)}
                </p>
                <h3 className="aiflow-type-section-title mt-1 font-semibold">
                  运行详情
                </h3>
              </div>
              <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                <span className="aiflow-type-meta text-muted-foreground">
                  {formatRunDuration(runDetail?.durationMs)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="aiflow-type-control min-h-11 lg:min-h-9"
                  onClick={onClearSelection}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  返回运行记录
                </Button>
                {runDetail &&
                  ["queued", "waiting", "blocked"].includes(
                    String(runDetail.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="aiflow-type-control h-11 text-aiflow-info lg:h-9"
                      disabled={controlPending}
                      onClick={() => {
                        if (runDetail.status === "blocked") {
                          resumeRun.mutate({ runId: runDetail.id });
                        } else {
                          setControlError("");
                          setControlDialog({
                            action: "pause",
                            runId: runDetail.id,
                          });
                        }
                      }}
                    >
                      {runDetail.status === "blocked" ? "恢复运行" : "暂停运行"}
                    </Button>
                  )}
                {runDetail &&
                  ["queued", "running", "waiting", "blocked"].includes(
                    String(runDetail.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="aiflow-type-control h-11 text-aiflow-warning lg:h-9"
                      disabled={controlPending}
                      onClick={() => {
                        setControlError("");
                        setControlDialog({
                          action: "cancel",
                          runId: runDetail.id,
                        });
                      }}
                    >
                      取消运行
                    </Button>
                  )}
                {runDetail &&
                  ["queued", "running", "waiting", "blocked"].includes(
                    String(runDetail.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="aiflow-type-control h-11 text-red-700 lg:h-9"
                      disabled={controlPending}
                      onClick={() => {
                        setControlError("");
                        setControlReason("");
                        setControlDialog({
                          action: "terminate",
                          runId: runDetail.id,
                        });
                      }}
                    >
                      终止运行
                    </Button>
                  )}
              </div>
            </div>
            {runDetail && (
              <dl
                aria-label="运行状态摘要"
                className="mt-4 grid gap-3 rounded-lg bg-muted p-3 sm:grid-cols-3"
              >
                {runStatusSummary(runDetail).map(item => (
                  <div key={item.label} className="min-w-0">
                    <dt className="aiflow-type-meta text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="aiflow-type-body mt-1 break-words font-medium text-foreground">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {selectedRunLoading && !selectedRun ? (
              <div
                role="status"
                className="aiflow-type-body mt-5 grid min-h-32 place-items-center text-muted-foreground"
              >
                正在读取运行节点详情…
              </div>
            ) : selectedRunError && !selectedRun ? (
              <div
                role="alert"
                className="aiflow-type-body mt-5 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-4 text-aiflow-danger"
              >
                <p>运行详情暂时无法读取。请重试，或返回运行记录列表。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 lg:min-h-9"
                    onClick={onRetrySelection}
                  >
                    <RotateCcw size={14} aria-hidden="true" /> 重试
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 lg:min-h-9"
                    onClick={onClearSelection}
                  >
                    返回运行记录
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                <div>
                  <h3 className="aiflow-type-control font-semibold">
                    节点执行记录 · {nodeEntries.length} 条
                  </h3>
                  <p className="aiflow-type-meta mt-1 text-muted-foreground">
                    同一节点的多次执行分别记录，展开可查看每次输入、输出和错误。
                  </p>
                </div>
                {!nodeEntries.length && (
                  <p className="aiflow-type-body text-muted-foreground">
                    暂无节点执行记录。
                  </p>
                )}
                {nodeEntries.map(
                  ({
                    node,
                    statusLabel,
                    orderLabel,
                    occurrence,
                    totalOccurrences,
                  }) => (
                    <details
                      key={node.id}
                      className="group min-w-0 rounded border border-border bg-muted p-3"
                    >
                      <summary className="aiflow-type-body flex min-w-0 cursor-pointer list-none items-center justify-between gap-3">
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span className="aiflow-type-meta shrink-0 tabular-nums text-muted-foreground">
                            {orderLabel}
                          </span>
                          <span className="min-w-0 break-words">
                            {node.nodeName || node.nodeId}
                          </span>
                          <span className="aiflow-type-meta rounded bg-card px-2 py-0.5 text-muted-foreground">
                            {workflowNodeTypeLabel(node.nodeType)}
                          </span>
                          <span
                            className={`aiflow-type-meta rounded px-2 py-0.5 font-medium ${node.status === "failed" ? "bg-destructive/10 text-destructive" : node.status === "success" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-card text-muted-foreground"}`}
                          >
                            {statusLabel}
                          </span>
                          {totalOccurrences > 1 && (
                            <span className="aiflow-type-meta text-muted-foreground">
                              第 {occurrence} 次执行记录
                            </span>
                          )}
                          {node.nodeName && node.nodeName !== node.nodeId && (
                            <code className="aiflow-type-code min-w-0 max-w-full break-words text-muted-foreground [overflow-wrap:anywhere]">
                              {node.nodeId}
                            </code>
                          )}
                        </span>
                        <span className="aiflow-type-meta shrink-0 text-muted-foreground">
                          {formatRunDuration(node.durationMs)}
                        </span>
                        <ChevronDown
                          aria-hidden="true"
                          size={14}
                          className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                        />
                      </summary>
                      <div className="aiflow-type-body mt-3 grid gap-3 border-t border-border pt-3">
                        {runDetail?.approvalGroups
                          ?.filter(
                            (group: RunApprovalGroup) =>
                              group.nodeId === node.nodeId
                          )
                          .map((group: RunApprovalGroup) => (
                            <RunApprovalProgress
                              key={group.nodeId}
                              group={group}
                            />
                          ))}
                        <RunPayloadDetails
                          title="输入"
                          value={node.inputJson}
                        />
                        <RunPayloadDetails
                          title="输出"
                          value={node.outputJson}
                          nodeType={node.nodeType}
                        />
                        <RunPayloadDetails
                          title="错误"
                          value={node.errorJson}
                        />
                      </div>
                    </details>
                  )
                )}
              </div>
            )}
          </section>
        )}
      </div>
      <Dialog
        open={Boolean(controlDialog)}
        onOpenChange={open => {
          if (!open && !controlPending) setControlDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {controlDialog?.action === "pause"
                ? "确认暂停运行"
                : controlDialog?.action === "terminate"
                  ? "确认终止运行"
                  : "确认取消运行"}
            </DialogTitle>
            <DialogDescription>
              {controlDialog?.action === "pause"
                ? "将在安全节点边界暂停，恢复后继续推进实例。"
                : "停止后不再继续推进该实例；已执行动作不会撤销，历史记录会保留。"}
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-sm text-muted-foreground">
            运行编号：{controlDialog?.runId}
          </p>
          {controlDialog?.action === "terminate" && (
            <label className="grid gap-2 text-sm">
              终止原因（必填）
              <textarea
                aria-label="终止原因"
                rows={3}
                maxLength={500}
                className="rounded-md border border-border bg-background p-3"
                value={controlReason}
                disabled={controlPending}
                onChange={event => setControlReason(event.target.value)}
              />
            </label>
          )}
          {controlError && (
            <p role="alert" className="text-sm text-destructive">
              {controlError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={controlPending}
              onClick={() => setControlDialog(null)}
            >
              返回
            </Button>
            <Button
              disabled={
                controlPending ||
                !controlDialog ||
                controlDialog.runId !== selectedRunId ||
                (controlDialog.action === "terminate" && !controlReason.trim())
              }
              onClick={async () => {
                if (!controlDialog || controlDialog.runId !== selectedRunId)
                  return;
                setControlError("");
                try {
                  const input = { runId: controlDialog.runId };
                  if (controlDialog.action === "pause")
                    await pauseRun.mutateAsync(input);
                  else if (controlDialog.action === "terminate")
                    await terminateRun.mutateAsync({
                      ...input,
                      reason: controlReason.trim(),
                    });
                  else await cancelRun.mutateAsync(input);
                  setControlDialog(null);
                } catch (error) {
                  setControlError(
                    error instanceof Error
                      ? error.message
                      : "操作失败，请重试。"
                  );
                }
              }}
            >
              {controlPending
                ? "正在提交…"
                : controlDialog?.action === "pause"
                  ? "确认暂停"
                  : controlDialog?.action === "terminate"
                    ? "确认终止"
                    : "确认取消"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
  fullWidthOnMobile = false,
}: {
  label: string;
  value: string | number;
  icon: typeof BarChart3;
  tone: "blue" | "emerald" | "red" | "amber" | "slate";
  fullWidthOnMobile?: boolean;
}) {
  const tones = {
    blue: "border-aiflow-info-border bg-aiflow-info-surface text-aiflow-info",
    emerald:
      "border-aiflow-success-border bg-aiflow-success-surface text-aiflow-success",
    red: "border-red-100 bg-red-50 text-red-700",
    amber:
      "border-aiflow-warning-border bg-aiflow-warning-surface text-aiflow-warning",
    slate: "border-border bg-muted text-foreground",
  };
  return (
    <div
      className={`min-w-0 rounded-lg border p-2.5 sm:p-4 ${fullWidthOnMobile ? "col-span-2 sm:col-span-1" : ""} ${tones[tone]}`}
    >
      <div className="aiflow-type-body flex items-center justify-between gap-1 font-medium">
        <span className="min-w-0 break-words">{label}</span>
        <Icon className="shrink-0" size={14} />
      </div>
      <p className="aiflow-type-display min-w-0 break-words font-bold tabular-nums mt-1 sm:mt-2">
        {value}
      </p>
    </div>
  );
}
