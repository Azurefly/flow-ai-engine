import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

function parse(value: unknown) { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value; } }

export function RunDetailContent({ run }: { run: any }) {
  if (!run) return <div className="grid min-h-48 place-items-center"><Loader2 className="animate-spin text-slate-400" size={22} /></div>;
  return <div className="space-y-3 p-5">{(run.nodeRuns ?? []).map((node: any) => <details key={node.id} className="rounded border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">{node.nodeName} <span className="ml-2 font-mono text-[10px] text-slate-400">{node.nodeType}</span></summary><div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 text-xs"><pre className="overflow-auto rounded bg-slate-950 p-3 text-emerald-200">{JSON.stringify(parse(node.inputJson), null, 2)}</pre><pre className="overflow-auto rounded bg-slate-950 p-3 text-emerald-200">{JSON.stringify(parse(node.outputJson), null, 2)}</pre></div></details>)}{!(run.nodeRuns ?? []).length && <p className="text-sm text-slate-500">该实例尚无节点执行日志。</p>}</div>;
}

export function RunDetailDialog({ run, onClose }: { run: any; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="流程实例详情"><section className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-slate-100 p-5"><div><p className="text-[10px] font-bold tracking-[.18em] text-blue-600">PROCESS INSTANCE</p><h3 className="mt-1 text-lg font-semibold text-slate-900">实例详情</h3><p className="mt-1 font-mono text-xs text-slate-500">{run?.id?.slice?.(0, 12) ?? "正在读取…"}</p></div><Button type="button" variant="ghost" size="sm" onClick={onClose}>关闭</Button></header><RunDetailContent run={run} /></section></div>;
}
