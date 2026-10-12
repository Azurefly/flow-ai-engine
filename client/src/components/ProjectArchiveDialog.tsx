import { useState } from "react";
import { Button } from "./ui/button";
import { CreationDialog } from "./CreationDialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { ProjectRecord } from "./ProjectWorkspace";

export default function ProjectArchiveDialog({ project, onClose }: { project: ProjectRecord; onClose: () => void }) {
  const utils = trpc.useUtils();
  const desiredStatus = project.status === "archived" ? "active" : "archived";
  const preview = trpc.project.lifecyclePreview.useQuery({ projectId: project.id }, { retry: false });
  const archived = trpc.workflow.archived.useQuery({ projectId: project.id }, { enabled: preview.data?.status === "archived", retry: false });
  const mutation = trpc.project.changeStatus.useMutation();
  const [error, setError] = useState("");
  const current = preview.data;
  const complete = current?.status === desiredStatus;
  const canConfirm = Boolean(current?.canManageArchive) && !preview.isFetching && !preview.isError && !complete;
  const submit = async () => {
    if (error) {
      const response = await preview.refetch();
      setError(response.error?.message ?? "");
      return;
    }
    if (!canConfirm || !current) return;
    try {
      await mutation.mutateAsync({ projectId: project.id, status: desiredStatus,
        expectedVersion: Number(current.lifecycleVersion), expectedWorkflowCount: Number(current.workflowCount) });
      await Promise.all([utils.project.invalidate(), utils.workflow.invalidate(), utils.data.invalidate()]);
      toast.success(desiredStatus === "archived" ? "业务及在用流程已归档，历史数据已保留。" : "业务已恢复，请按需恢复流程并重新发布。" );
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "操作失败，请刷新后重试。"); }
  };
  return <CreationDialog open onOpenChange={open => { if (!open) onClose(); }}
    title={desiredStatus === "archived" ? "归档业务" : "业务归档资料"}
    description={desiredStatus === "archived" ? "归档会收起业务空间，并归档其中的在用流程。所有定义、任务和运行历史会保留。" : "恢复业务不会自动恢复流程、发布版本或启用调度，请按需逐项恢复。"}
    submitLabel={error ? "刷新并重新确认" : desiredStatus === "archived" ? "确认归档业务" : "恢复业务"}
    pending={mutation.isPending} submitDisabled={error ? preview.isFetching : !canConfirm}
    errorMessage={error} onSubmit={submit}>
    <section className="aiflow-type-body space-y-3" aria-label="业务归档确认信息">
      <p className="break-words font-semibold">{current?.name ?? project.name}</p>
      <p className="aiflow-type-code break-all text-muted-foreground">{current?.code ?? project.code}</p>
      {preview.isLoading ? <p role="status">正在读取业务状态…</p> : preview.isError ?
        <div role="alert">业务状态读取失败，未执行任何变更。<Button type="button" variant="outline" onClick={() => void preview.refetch()}>重试读取</Button></div> : !current ?
        <p role="alert">业务不存在或当前账号已无查看权限。</p> : <>
          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <dt>业务状态</dt><dd>{current.status === "archived" ? "已归档" : "在用"}</dd>
            <dt>在用流程</dt><dd>{Number(current.workflowCount)} 个</dd>
            <dt>已归档流程</dt><dd>{Number(current.archivedWorkflowCount)} 个</dd>
          </dl>
          {complete && <p role="status">此操作已由其他用户完成，请关闭对话框查看当前结果。</p>}
          {!current.canManageArchive && <p role="status">仅业务所有者或管理员可以归档、恢复业务。</p>}
          {desiredStatus === "archived" && <p>有未结束的运行、人工任务或启用中的调度时，会拒绝归档；请先完成办理或暂停调度。</p>}
          {desiredStatus === "active" && Number(current.workflowCount) > 0 && <p>检测到历史遗留的在用流程；恢复业务时会将它们归档。存在活动运行、人工任务或调度时，请先结束这些工作。</p>}
        </>}
      {error && <a className="inline-flex min-h-11 items-center text-aiflow-info underline" href="#/runs/workbench">查看运行与待办工作台</a>}
      {current?.status === "archived" && <section className="space-y-2 border-t border-border pt-3" aria-label="归档流程目录">
        <h3 className="font-semibold">已归档流程</h3>
        {archived.isLoading ? <p role="status">正在读取归档流程…</p> : archived.isError ?
          <div role="alert">归档流程读取失败。<Button type="button" variant="outline" onClick={() => void archived.refetch()}>重试</Button></div> :
          <ul className="max-h-56 space-y-2 overflow-y-auto">{((archived.data ?? []) as unknown as Array<{ id: string; name: string }>).map(flow => <li key={flow.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
            <span className="min-w-0 break-words">{flow.name}</span><a className="inline-flex min-h-11 items-center text-aiflow-info underline" href={`#/flows/workflow/${encodeURIComponent(flow.id)}/detail`}>查看历史</a>
          </li>)}</ul>}
      </section>}
    </section>
  </CreationDialog>;
}
