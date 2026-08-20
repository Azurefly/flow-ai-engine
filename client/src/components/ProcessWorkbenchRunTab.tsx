import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { RunDetailContent } from "./WorkflowGovernanceRunDetail";
import { X } from "lucide-react";

export function ProcessWorkbenchRunTab({ runId, onClose }: { runId: string; onClose: () => void }) {
  const detail = trpc.workflow.runDetail.useQuery({ runId }, { retry: false });
  const run = detail.data as any;
  const title = run?.workflowName || `实例 ${runId.slice(0, 8)}`;

  return <section data-process-workbench-run-tab className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 pt-2">
      <span className="shrink-0 rounded-t border border-b-0 border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">流程工作台</span>
      <span className="ml-1 flex min-w-0 shrink-0 items-center gap-2 rounded-t border border-b-0 border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700">
        <span className="max-w-48 truncate">实例详情 · {title}</span>
        <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-slate-400 hover:text-slate-700" aria-label="关闭实例详情页签" title="关闭实例详情" onClick={onClose}><X size={13} /></Button>
      </span>
    </div>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-[10px] font-bold tracking-[.18em] text-blue-600">PROCESS INSTANCE</p><h2 className="mt-1 text-lg font-semibold text-slate-900">实例详情</h2><p className="mt-1 font-mono text-xs text-slate-500">{runId.slice(0, 12)}</p></div><Button type="button" variant="outline" size="sm" onClick={onClose}>返回工作台</Button></header>
    {detail.isError ? <p className="p-5 text-sm text-red-600">当前账户无权查看该实例，或该实例已不存在。</p> : <RunDetailContent run={run} />}
  </section>;
}
