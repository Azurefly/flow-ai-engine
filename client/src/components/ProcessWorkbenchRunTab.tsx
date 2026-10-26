import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { RunDetailContent } from "./WorkflowGovernanceRunDetail";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { runDetailRefreshInterval } from "@shared/run-detail-refresh";

export function ProcessWorkbenchRunTab({
  runId,
  baseTabLabel,
  onClose,
  onReturn,
  entryTaskId,
}: {
  runId: string;
  baseTabLabel: string;
  onClose: () => void;
  onReturn: () => void;
  entryTaskId?: string;
}) {
  const detail = trpc.workflow.runDetail.useQuery(
    { runId },
    {
      retry: false,
      refetchInterval: query =>
        runDetailRefreshInterval(
          query.state.data?.status,
          Boolean(query.state.error)
        ),
      refetchIntervalInBackground: false,
    }
  );
  const run = detail.data as any;
  const workflowName =
    typeof run?.workflowName === "string" ? run.workflowName : "";

  return (
    <section
      data-process-workbench-run-tab
      className="min-w-0 rounded-lg border border-border bg-card shadow-sm"
    >
      <nav
        data-process-workbench-tabs
        aria-label="实例详情路径"
        className="flex items-center gap-2 border-b border-border px-5 py-2 aiflow-type-body text-muted-foreground"
      >
        <button
          type="button"
          className="min-h-9 hover:text-foreground"
          onClick={onReturn}
        >
          返回{baseTabLabel}
        </button>
        <span aria-hidden="true">/</span>
        <span aria-current="page">实例详情</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
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
          <details className="aiflow-type-meta mt-1 text-muted-foreground">
            <summary className="cursor-pointer">
              实例编号 · {runId.slice(0, 8)}
            </summary>
            <p className="break-all">实例编号：{runId}</p>
          </details>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={detail.isFetching}
            onClick={() => void detail.refetch()}
          >
            <RotateCcw
              size={14}
              className={detail.isFetching ? "animate-spin" : undefined}
            />
            刷新实例详情
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={onClose}
          >
            返回工作台
          </Button>
        </div>
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
        <RunDetailContent key={`${runId}:${entryTaskId ?? ""}`} run={run} entryTaskId={entryTaskId} />
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          当前实例暂无可展示的详情。
        </div>
      )}
    </section>
  );
}
