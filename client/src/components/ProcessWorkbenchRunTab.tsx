import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { RunDetailContent } from "./WorkflowGovernanceRunDetail";
import { AlertTriangle, Loader2, RotateCcw, X } from "lucide-react";

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
      className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <div
        data-process-workbench-tabs
        className="flex overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 pt-2"
      >
        <button
          type="button"
          className="shrink-0 rounded-t border border-b-0 border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800"
          onClick={onReturn}
          title={`返回${baseTabLabel}`}
        >
          {baseTabLabel}
        </button>
        <span className="ml-1 flex min-w-0 shrink-0 items-center gap-2 rounded-t border border-b-0 border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700">
          <span className="max-w-48 truncate">实例详情 · {title}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 text-slate-400 hover:text-slate-700"
            aria-label="关闭实例详情页签"
            title="关闭实例详情"
            onClick={onClose}
          >
            <X size={13} />
          </Button>
        </span>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <p className="text-[10px] font-bold tracking-[.18em] text-blue-600">
            PROCESS INSTANCE
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">实例详情</h2>
          <p className="mt-1 font-mono text-xs text-slate-500">{runId.slice(0, 12)}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          返回工作台
        </Button>
      </header>
      {detail.isLoading ? (
        <div
          role="status"
          className="grid min-h-64 place-items-center p-8 text-center text-sm text-slate-500"
        >
          <div>
            <Loader2 className="mx-auto animate-spin text-blue-600" size={22} />
            <p className="mt-3">正在读取实例节点日志…</p>
          </div>
        </div>
      ) : detail.isError ? (
        <div
          role="alert"
          className="grid min-h-64 place-items-center p-8 text-center"
        >
          <div>
            <AlertTriangle className="mx-auto text-rose-500" size={22} />
            <p className="mt-3 text-sm font-medium text-slate-700">
              实例详情加载失败
            </p>
            <p className="mt-1 break-words text-xs text-slate-500">
              {detail.error.message || "当前账户无权查看该实例，或该实例已不存在。"}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void detail.refetch()}
            >
              <RotateCcw size={13} /> 重试
            </Button>
          </div>
        </div>
      ) : run ? (
        <RunDetailContent run={run} />
      ) : (
        <div className="p-8 text-center text-sm text-slate-400">
          当前实例暂无可展示的详情。
        </div>
      )}
    </section>
  );
}
