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
  const workflowName =
    typeof run?.workflowName === "string" ? run.workflowName : "";

  return (
    <section
      data-process-workbench-run-tab
      className="min-w-0 rounded-lg border border-border bg-card shadow-sm"
    >
      <div
        data-process-workbench-tabs
        className="grid min-w-0 grid-cols-2 gap-1 border-b border-border bg-muted px-2 pt-2 sm:flex sm:flex-wrap sm:px-3"
      >
        <button
          type="button"
          className="aiflow-type-control min-w-0 rounded-t border border-b-0 border-border bg-card px-2 py-2 text-center text-muted-foreground hover:bg-muted hover:text-foreground sm:px-3 sm:text-left"
          onClick={onReturn}
          title={`返回${baseTabLabel}`}
        >
          {baseTabLabel}
        </button>
        <span
          aria-current="page"
          className="aiflow-type-control ml-1 flex min-w-0 items-center justify-center gap-1 rounded-t border border-b-0 border-aiflow-info-border bg-card px-2 py-2 font-medium text-aiflow-info sm:gap-2 sm:px-3"
        >
          <span className="min-w-0 truncate">实例详情</span>
          <span aria-hidden="true">·</span>
          <span className="aiflow-type-meta min-w-0 max-w-48 truncate">
            {runId.slice(0, 8)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="关闭实例详情页签"
            title="关闭实例详情"
            onClick={onClose}
          >
            <X size={13} />
          </Button>
        </span>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0 flex-1">
          <p className="aiflow-type-meta font-bold tracking-[.18em] text-aiflow-info">
            PROCESS INSTANCE
          </p>
          <h1
            data-aiflow-page-title=""
            className="aiflow-type-page-title mt-1 font-semibold text-foreground"
          >
            实例详情
          </h1>
          {workflowName && (
            <p
              data-instance-workflow-name=""
              className="aiflow-type-body mt-2 break-words font-medium text-foreground"
            >
              {workflowName.replaceAll("_", "_\u200b")}
            </p>
          )}
          <p className="aiflow-type-code mt-1 break-all font-mono text-muted-foreground">
            实例编号：{runId}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          返回工作台
        </Button>
      </header>
      {detail.isLoading ? (
        <div
          role="status"
          className="grid min-h-64 place-items-center p-8 text-center text-sm text-muted-foreground"
        >
          <div>
            <Loader2
              className="mx-auto animate-spin text-aiflow-info"
              size={22}
            />
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
            <p className="mt-3 text-sm font-medium text-foreground">
              实例详情加载失败
            </p>
            <p className="aiflow-type-body mt-1 break-words text-muted-foreground">
              {detail.error.message ||
                "当前账户无权查看该实例，或该实例已不存在。"}
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
        <div className="p-8 text-center text-sm text-muted-foreground">
          当前实例暂无可展示的详情。
        </div>
      )}
    </section>
  );
}
