import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { RunDetailContent } from "./WorkflowGovernanceRunDetail";

function formatTime(value: unknown) {
  return value
    ? new Date(String(value)).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function statusLabel(status: unknown) {
  const value = String(status || "unknown");
  const labels: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    waiting: "等待人工处理",
    blocked: "已暂停",
    success: "成功",
    failed: "失败",
    cancelled: "已取消",
    terminated: "已终止",
  };
  return labels[value] ?? value;
}

export function ProcessWorkbenchRunTab({
  runId,
  baseTabLabel,
  onClose,
  onReturn,
}: {
  runId: string;
  baseTabLabel: string;
  onClose: () => void;
  onReturn: () => void;
}) {
  const detail = trpc.workflow.runDetail.useQuery({ runId }, { retry: false });
  const run = detail.data as any;
  const title = run?.workflowName || `实例 ${runId.slice(0, 8)}`;

  return (
    <section
      data-process-workbench-run-tab
      className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <div
        data-process-workbench-tabs
        role="tablist"
        aria-label="流程工作台详情页签"
        className="flex overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 pt-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected="false"
          className="min-h-11 shrink-0 rounded-t border border-b-0 border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800"
          onClick={onReturn}
          title={`返回${baseTabLabel}`}
        >
          {baseTabLabel}
        </button>
        <span
          role="tab"
          aria-selected="true"
          className="ml-1 flex min-w-0 shrink-0 items-center gap-2 rounded-t border border-b-0 border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700"
        >
          <span className="max-w-48 truncate">实例详情 · {title}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-slate-400 hover:text-slate-700"
            aria-label="关闭实例详情页签"
            title="关闭实例详情"
            onClick={onClose}
          >
            <X size={13} />
          </Button>
        </span>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[.18em] text-blue-600">
            PROCESS INSTANCE
          </p>
          <h2 className="mt-1 break-words text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">
            {runId}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          返回工作台
        </Button>
      </header>
      {run && (
        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Meta
            label="流程版本"
            value={run.definitionVersion ? `v${run.definitionVersion}` : "快照版本"}
          />
          <Meta
            label="触发人"
            value={
              run.triggeredByName ||
              run.username ||
              (run.triggeredByUserId ? `用户 ${run.triggeredByUserId}` : "—")
            }
          />
          <Meta label="实例状态" value={statusLabel(run.status)} />
          <Meta label="开始时间" value={formatTime(run.startedAt ?? run.createdAt)} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50/70 px-5 py-3 text-xs text-amber-800">
        <ShieldCheck size={14} className="shrink-0" />
        <span>
          详情仅展示当前授权范围内的服务端运行事实；重跑与审计导出暂未开放，不会在此伪造操作。
        </span>
      </div>
      {detail.isLoading ? (
        <div
          className="grid min-h-48 place-items-center gap-2 p-5 text-center"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="animate-spin text-slate-400" size={22} />
          <p className="text-sm text-slate-500">正在读取流程实例详情…</p>
        </div>
      ) : detail.isError ? (
        <div
          className="grid min-h-48 place-items-center gap-3 p-5 text-center"
          role="alert"
        >
          <AlertTriangle className="text-red-500" size={24} />
          <div>
            <p className="text-sm text-red-600">
              流程实例详情读取失败，可能无权查看或实例已不存在。
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 min-h-11"
              onClick={() => void detail.refetch()}
            >
              <RefreshCw size={14} />
              重试
            </Button>
          </div>
        </div>
      ) : run ? (
        <RunDetailContent run={run} />
      ) : (
        <div className="grid min-h-48 place-items-center gap-2 p-5 text-center text-sm text-slate-500">
          <Clock3 size={24} />
          <p>未找到该流程实例详情。</p>
        </div>
      )}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-medium text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-700">
        {value}
      </p>
    </div>
  );
}
