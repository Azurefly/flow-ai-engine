import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

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
  });
  const metrics = trpc.workflow.runMetrics.useQuery(filter, {
    enabled: Boolean(workflowId),
    refetchInterval: 5_000,
  });
  const alerts = trpc.workflow.alerts.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const markRead = trpc.workflow.markAlertRead.useMutation({
    onSuccess: () => void utils.workflow.alerts.invalidate(),
  });
  const cancelRun = trpc.workflow.cancelRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runDetail.invalidate();
    },
    onError: error => window.alert(error.message),
  });
  const terminateRun = trpc.workflow.terminateRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runDetail.invalidate();
    },
    onError: error => window.alert(error.message),
  });
  const pauseRun = trpc.workflow.pauseRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runDetail.invalidate();
    },
    onError: error => window.alert(error.message),
  });
  const resumeRun = trpc.workflow.resumeRun.useMutation({
    onSuccess: () => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runDetail.invalidate();
    },
    onError: error => window.alert(error.message),
  });
  const workflowAlerts = (alerts.data ?? []).filter(
    (alert: any) => alert.workflowId === workflowId
  );
  const controlPending =
    cancelRun.isPending ||
    terminateRun.isPending ||
    pauseRun.isPending ||
    resumeRun.isPending;

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
        <div className="w-fit rounded bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">
          自动刷新 · 5 秒
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
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="总运行"
          value={metrics.data?.totalRuns ?? 0}
          icon={BarChart3}
          tone="blue"
        />
        <MetricCard
          label="成功"
          value={metrics.data?.successfulRuns ?? 0}
          icon={CheckCircle2}
          tone="emerald"
        />
        <MetricCard
          label="失败"
          value={metrics.data?.failedRuns ?? 0}
          icon={XCircle}
          tone="red"
        />
        <MetricCard
          label="失败率"
          value={`${metrics.data?.failureRate ?? 0}%`}
          icon={AlertTriangle}
          tone="amber"
        />
        <MetricCard
          label="平均耗时"
          value={`${metrics.data?.averageDurationMs ?? 0} ms`}
          icon={Clock3}
          tone="slate"
        />
      </div>
      <section className="overflow-hidden rounded-lg border border-red-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-red-100 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <AlertTriangle size={15} />
            失败告警
          </div>
          <span className="rounded bg-white px-2 py-0.5 text-[10px] text-red-700">
            {workflowAlerts.filter((alert: any) => !alert.readAt).length} 未读
          </span>
        </div>
        <div className="max-h-48 overflow-y-auto">
          {workflowAlerts.map((alert: any) => (
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
          ))}
          {!workflowAlerts.length && (
            <p className="p-4 text-center text-xs text-slate-400">
              当前筛选范围内没有失败告警。
            </p>
          )}
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm font-semibold">
            <span>运行记录</span>
            {runs.isFetching && (
              <Loader2 className="animate-spin text-slate-400" size={14} />
            )}
          </div>
          <div className="max-h-[650px] overflow-y-auto">
            {(runs.data ?? []).map((run: any) => (
              <button
                key={run.id}
                onClick={() => onSelect(run.id)}
                className={`w-full border-b border-slate-100 p-4 text-left hover:bg-slate-50 ${selectedRun?.id === run.id ? "bg-blue-50" : ""}`}
              >
                <div className="flex justify-between gap-2">
                  <code className="text-xs text-slate-500">
                    {run.id.slice(0, 8)}
                  </code>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${run.status === "success" ? "bg-emerald-100 text-emerald-700" : run.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <span>{formatTime(run.createdAt)}</span>
                  <span>{run.durationMs ?? "—"} ms</span>
                  <span>
                    {run.triggeredByName ||
                      run.username ||
                      `用户 ${run.triggeredByUserId ?? "—"}`}
                  </span>
                </div>
              </button>
            ))}
            {!runs.isFetching && !(runs.data ?? []).length && (
              <p className="p-6 text-center text-sm text-slate-400">
                当前筛选条件下尚无运行记录。
              </p>
            )}
          </div>
        </section>
        <section className="min-h-80 rounded-lg border border-slate-200 bg-white p-5">
          {selectedRun ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-[.18em] text-slate-400">
                    RUN {selectedRun.id.slice(0, 8)}
                  </p>
                  <h3 className="mt-1 font-semibold">
                    {selectedRun.status === "success" ? "运行成功" : "运行详情"}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-xs text-slate-400">
                    {selectedRun.durationMs ?? "—"} ms
                  </span>
                  {["queued", "waiting", "blocked"].includes(
                    String(selectedRun.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs text-blue-700"
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
                      {selectedRun.status === "blocked" ? "恢复运行" : "暂停运行"}
                    </Button>
                  )}
                  {["queued", "running", "waiting", "blocked"].includes(
                    String(selectedRun.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs text-amber-700"
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
                      取消运行
                    </Button>
                  )}
                  {["queued", "running", "waiting", "blocked"].includes(
                    String(selectedRun.status)
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs text-red-700"
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
                      终止运行
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-5 grid gap-3">
                {selectedRun.nodeRuns?.map((node: any) => (
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
