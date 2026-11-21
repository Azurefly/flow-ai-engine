import { lazy, Suspense } from "react";
import { RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { runDetailRefreshInterval } from "@shared/run-detail-refresh";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { RunInstancePage } from "./RunInstancePage";
import { RunDetailFacts, RunDetailSummary } from "./WorkflowGovernanceRunDetail";

const RunExecutionCanvas = lazy(() => import("./RunExecutionCanvas"));

export function ProcessWorkbenchRunPage({
  runId,
  entryTaskId,
  onBack,
}: {
  runId: string;
  entryTaskId?: string;
  onBack: () => void;
}) {
  const detail = trpc.workflow.runDetail.useQuery(
    { runId },
    {
      retry: false,
      refetchInterval: query =>
        runDetailRefreshInterval(query.state.data?.status, Boolean(query.state.error)),
      refetchIntervalInBackground: false,
    }
  );
  const run = detail.isError ? null : detail.data;
  const refresh = () => void detail.refetch();

  return (
    <RunInstancePage
      runId={runId}
      workflowName={typeof run?.workflowName === "string" ? run.workflowName : undefined}
      flowType={typeof run?.flowType === "string" ? run.flowType : undefined}
      onBack={onBack}
      backLabel="返回流程工作台"
      summary={run && <div className="border-t pt-2"><RunDetailSummary run={run} /></div>}
      actions={(
        <>
          {run && (
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">实例信息</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
                <DialogTitle>实例信息</DialogTitle>
                <RunDetailFacts run={run} />
              </DialogContent>
            </Dialog>
          )}
          <Button type="button" variant="outline" size="sm" disabled={detail.isFetching} onClick={refresh}>
            <RotateCcw size={14} aria-hidden="true" className={detail.isFetching ? "animate-spin" : undefined} />
            刷新实例详情
          </Button>
        </>
      )}
    >
      {detail.isLoading ? (
        <p role="status" className="p-4 text-muted-foreground">正在读取实例节点日志…</p>
      ) : run ? (
        <Suspense fallback={<p role="status" className="p-4">正在准备实例流程图…</p>}>
          <RunExecutionCanvas run={run} entryTaskId={entryTaskId} workspace />
        </Suspense>
      ) : (
        <div role="alert" className="aiflow-type-body rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-4 text-aiflow-danger">
          <p>{detail.error?.message || "运行记录不存在或无访问权限。"}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" disabled={detail.isFetching} onClick={refresh}>
            <RotateCcw size={14} aria-hidden="true" /> 重试
          </Button>
        </div>
      )}
    </RunInstancePage>
  );
}
