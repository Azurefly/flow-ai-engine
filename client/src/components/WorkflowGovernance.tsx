import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { RunDetailDialog } from "./WorkflowGovernanceRunDetail";
import { GitCompareArrows, History, Loader2, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function formatTime(value: unknown) {
  return value ? new Date(String(value)).toLocaleString("zh-CN", { hour12: false }) : "—";
}

export default function WorkflowGovernance({ workflowId, canEdit, canPublish }: { workflowId: string; canEdit: boolean; canPublish: boolean }) {
  const utils = trpc.useUtils();
  const versions = trpc.workflow.versions.useQuery({ workflowId }, { retry: false });
  const workflow = trpc.workflow.get.useQuery({ id: workflowId }, { retry: false });
  const runs = trpc.workflow.runs.useQuery({ workflowId }, { retry: false });
  const items = (versions.data ?? []) as any[];
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [toVersion, setToVersion] = useState<number | null>(null);
  const [runKeyword, setRunKeyword] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun = trpc.workflow.runDetail.useQuery({ runId: selectedRunId ?? "00000000" }, { enabled: Boolean(selectedRunId), retry: false });

  useEffect(() => {
    if (!items.length) return;
    setToVersion(current => current ?? Number(items[0].version));
    setFromVersion(current => current ?? Number(items[1]?.version ?? items[0].version));
  }, [items]);

  const diffInput = useMemo(() => ({ workflowId, fromVersion: fromVersion ?? 1, toVersion: toVersion ?? 1 }), [fromVersion, toVersion, workflowId]);
  const diff = trpc.workflow.versionDiff.useQuery(diffInput, { enabled: Boolean(fromVersion && toVersion && fromVersion !== toVersion), retry: false });
  const rollback = trpc.workflow.rollbackVersion.useMutation({
    onSuccess: () => {
      void utils.workflow.list.invalidate();
      void utils.workflow.versions.invalidate({ workflowId });
      void utils.workflow.versionDiff.invalidate();
      toast.success("已恢复目标版本，并生成新的可审计快照。");
    },
    onError: error => toast.error(error.message),
  });

  const item = workflow.data as any;
  const stages = [
    { label: "流程设计", done: Boolean(item), detail: item?.definitionVersion ? `v${item.definitionVersion}` : "草稿" },
    { label: "审核", done: item?.auditStatus === "approved", detail: item?.auditStatus === "approved" ? "审核通过" : item?.auditStatus === "rejected" ? "审核驳回" : "待审核" },
    { label: "发布", done: item?.status === "published", detail: item?.status === "published" ? "已发布" : "未发布" },
    { label: "运行", done: item?.status === "published", detail: item?.status === "published" ? "可在已启动流程中发起" : "发布后可发起" },
  ];
  const visibleRuns = ((runs.data ?? []) as any[]).filter(run => `${run.id} ${run.triggeredByName ?? run.username ?? ""} ${run.status}`.toLowerCase().includes(runKeyword.trim().toLowerCase()));

  return <><section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 p-4"><p className="text-[10px] font-bold tracking-[.18em] text-blue-600">PROCESS DETAIL</p><div className="mt-1 flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-sm font-semibold text-slate-900">流程引导与基本信息</h3><p className="mt-1 text-xs text-slate-500">原始详情页的设计、审核、发布和实例运行路径；每项状态均来自当前流程真实数据。</p></div><span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{item?.flowType === "data" ? "数据流程" : item?.flowType === "control" ? "控制流程" : "状态流程"}</span></div></div>
    <div className="grid gap-3 p-4 md:grid-cols-4">{stages.map((stage, index) => <div key={stage.label} className="relative rounded border border-slate-100 bg-slate-50 p-3"><span className={`mb-2 inline-block h-2.5 w-2.5 rounded-full ${stage.done ? "bg-emerald-500" : "bg-slate-300"}`} /><p className="text-xs font-semibold text-slate-800">{index + 1}. {stage.label}</p><p className="mt-1 text-[11px] text-slate-500">{stage.detail}</p></div>)}</div>
    <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-3"><div><p className="text-[10px] font-bold tracking-[.12em] text-slate-400">流程名称</p><p className="mt-1 truncate text-sm font-medium text-slate-700">{item?.name ?? "正在读取…"}</p></div><div><p className="text-[10px] font-bold tracking-[.12em] text-slate-400">流程说明</p><p className="mt-1 truncate text-sm text-slate-600">{item?.description || "未填写流程说明"}</p></div><div><p className="text-[10px] font-bold tracking-[.12em] text-slate-400">详细配置</p><Button type="button" variant="outline" size="sm" className="mt-1 h-7 text-xs" onClick={() => window.dispatchEvent(new Event("flow:inspect-node"))}>查看详细配置</Button></div></div>
  </section><section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold tracking-[.18em] text-blue-600">STARTED PROCESS LIST</p><h3 className="mt-1 text-sm font-semibold text-slate-900">已启动流程列表</h3></div><label className="relative block"><Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" /><input className="h-8 w-60 rounded border border-slate-200 bg-white pl-8 pr-2 text-xs outline-none focus:border-blue-400" value={runKeyword} onChange={event => setRunKeyword(event.target.value)} placeholder="请输入关键词按 Enter 搜索" /></label></div><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">已启动流程 ID</th><th className="px-4 py-3">业务名称</th><th className="px-4 py-3">流程名称</th><th className="px-4 py-3">发送方</th><th className="px-4 py-3">创建时间</th><th className="px-4 py-3">更新时间</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">流程状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody>{visibleRuns.map(run => <tr key={run.id} className="border-t border-slate-100"><td className="px-4 py-3 font-mono text-slate-500">{String(run.id).slice(0, 8)}</td><td className="px-4 py-3">当前项目</td><td className="px-4 py-3 font-medium text-slate-700">{item?.name ?? "当前流程"}</td><td className="px-4 py-3">{run.triggeredByName || run.username || `用户 ${run.triggeredByUserId ?? "—"}`}</td><td className="px-4 py-3 text-slate-500">{formatTime(run.createdAt)}</td><td className="px-4 py-3 text-slate-500">{formatTime(run.finishedAt ?? run.createdAt)}</td><td className="px-4 py-3"><span className={`rounded px-1.5 py-0.5 ${run.status === "success" ? "bg-emerald-100 text-emerald-700" : run.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{run.status}</span></td><td className="px-4 py-3">{item?.status === "published" ? "已发布" : "未发布"}</td><td className="px-4 py-3 text-right"><Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-blue-700" onClick={() => setSelectedRunId(String(run.id))}>实例详情</Button></td></tr>)}{!runs.isLoading && !visibleRuns.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">当前关键词下尚无已启动流程。</td></tr>}</tbody></table></div></section>{selectedRunId && <RunDetailDialog run={selectedRun.data as any} onClose={() => setSelectedRunId(null)} />}<section className="mt-4 rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="flex items-center gap-1.5 text-[10px] font-bold tracking-[.18em] text-indigo-600"><History size={13} />VERSION GOVERNANCE</p><h3 className="mt-1 text-sm font-semibold text-slate-900">版本快照、差异与安全回滚</h3></div>
      <span className="inline-flex w-fit items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600"><ShieldCheck size={12} />{canEdit ? "可恢复版本" : "只读版本历史"}</span>
    </div>
    <div className="grid gap-4 p-4 xl:grid-cols-[260px_1fr]">
      <div className="max-h-64 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-2">
        {versions.isLoading && <p className="p-3 text-xs text-slate-400">正在读取版本快照…</p>}
        {items.map((version: any) => <div key={version.id} className={`mb-1 rounded border p-2.5 ${Number(version.version) === toVersion ? "border-indigo-200 bg-indigo-50" : "border-transparent bg-white"}`}>
          <div className="flex items-center justify-between gap-2"><button type="button" className="font-mono text-xs font-semibold text-indigo-700 hover:underline" onClick={() => setToVersion(Number(version.version))}>v{version.version}</button><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{version.changeSource}</span></div>
          <p className="mt-1 truncate text-xs font-medium text-slate-700">{version.name}</p><p className="mt-1 text-[10px] text-slate-400">{formatTime(version.createdAt)} · {version.creatorName || version.username || "系统"}</p>
          {version.restoredFromVersion && <p className="mt-1 text-[10px] text-amber-700">恢复自 v{version.restoredFromVersion}</p>}
          {canEdit && <Button type="button" size="sm" variant="ghost" className="mt-1 h-6 px-1.5 text-[10px] text-indigo-700" disabled={rollback.isPending || (version.status === "published" && !canPublish)} onClick={() => { if (window.confirm(`将流程恢复到 v${version.version} 吗？系统会新建一个可审计版本。`)) rollback.mutate({ workflowId, targetVersion: Number(version.version) }); }}>{rollback.isPending ? <Loader2 className="animate-spin" size={11} /> : <RotateCcw size={11} />}恢复此版本</Button>}
        </div>)}
        {!versions.isLoading && !items.length && <p className="p-3 text-xs text-slate-400">当前流程尚未生成版本快照。</p>}
      </div>
      <div className="rounded border border-slate-100 p-3">
        <div className="flex flex-wrap items-center gap-2"><GitCompareArrows size={14} className="text-indigo-600" /><span className="text-xs font-semibold text-slate-700">版本差异</span><select className="h-8 rounded border border-slate-200 bg-white px-2 text-xs" value={fromVersion ?? ""} onChange={event => setFromVersion(Number(event.target.value))}>{items.map((version: any) => <option key={`from-${version.id}`} value={version.version}>基准 v{version.version}</option>)}</select><span className="text-xs text-slate-400">→</span><select className="h-8 rounded border border-slate-200 bg-white px-2 text-xs" value={toVersion ?? ""} onChange={event => setToVersion(Number(event.target.value))}>{items.map((version: any) => <option key={`to-${version.id}`} value={version.version}>比较 v{version.version}</option>)}</select></div>
        {diff.data ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><DiffBlock label="新增节点" items={diff.data.addedNodes.map((node: any) => `${node.name} · ${node.type}`)} tone="emerald" /><DiffBlock label="移除节点" items={diff.data.removedNodes.map((node: any) => `${node.name} · ${node.type}`)} tone="red" /><DiffBlock label="变更节点" items={diff.data.changedNodes.map((node: any) => `${node.name}：${node.changedFields.join("、")}`)} tone="amber" /><DiffBlock label="连线变化" items={[`新增 ${diff.data.addedEdges.length} 条`, `移除 ${diff.data.removedEdges.length} 条`]} tone="slate" /></div> : <div className="mt-4 rounded bg-slate-50 p-4 text-xs leading-5 text-slate-500">选择两个不同版本后，将展示节点、配置与连线的结构化差异。</div>}
      </div>
    </div>
  </section></>;
}

function DiffBlock({ label, items, tone }: { label: string; items: string[]; tone: "emerald" | "red" | "amber" | "slate" }) {
  const classes = { emerald: "border-emerald-100 bg-emerald-50 text-emerald-800", red: "border-red-100 bg-red-50 text-red-800", amber: "border-amber-100 bg-amber-50 text-amber-800", slate: "border-slate-200 bg-slate-50 text-slate-700" };
  return <div className={`rounded border p-3 ${classes[tone]}`}><p className="text-xs font-semibold">{label}</p><div className="mt-2 grid gap-1 text-[11px]">{items.length ? items.map(item => <span key={item}>• {item}</span>) : <span>无变化</span>}</div></div>;
}
