import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import WorkflowCanvas from "@/components/WorkflowCanvas";
import { trpc } from "@/lib/trpc";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Download,
  FileJson,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Image,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ProjectRecord } from "./ProjectWorkspace";

type Folder = {
  id: string;
  parentId?: string | null;
  name: string;
  description?: string | null;
};
type WarehouseWorkflow = {
  id: string;
  name: string;
  description?: string | null;
  folderId?: string | null;
  flowType: string;
  status: string;
  auditStatus: string;
  definitionVersion: number;
};
type ArchivedWorkflow = WarehouseWorkflow & {
  projectId?: string | null;
  archivedAt?: string | null;
  archivedByUserId?: number | null;
  canRestore?: boolean;
};
type FolderDialog =
  | { mode: "sibling" | "child"; target: Folder }
  | { mode: "selected" }
  | null;
type DeleteTarget =
  | { kind: "folder"; folder: Folder }
  | { kind: "workflow"; workflow: WarehouseWorkflow }
  | null;

function FlowBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    state: "bg-blue-100 text-blue-700",
    control: "bg-violet-100 text-violet-700",
    data: "bg-emerald-100 text-emerald-700",
  };
  const labels: Record<string, string> = {
    state: "状态",
    control: "控制",
    data: "数据",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${styles[type] ?? "bg-slate-100 text-slate-600"}`}
    >
      {labels[type] ?? type}
    </span>
  );
}

export default function WorkflowWarehouse({
  projects,
  onOpenWorkflow,
}: {
  projects: ProjectRecord[];
  onOpenWorkflow: (project: ProjectRecord, workflowId: string) => void;
}) {
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [folderDialog, setFolderDialog] = useState<FolderDialog>(null);
  const [folderDialogName, setFolderDialogName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [keyword, setKeyword] = useState("");
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const currentProject =
    projects.find(project => project.id === projectId) ?? projects[0] ?? null;
  const activeProjectId = currentProject?.id ?? "00000000";
  const warehouse = trpc.project.warehouse.useQuery(
    { projectId: activeProjectId },
    { enabled: Boolean(currentProject) }
  );
  const archivedWorkflows = trpc.workflow.archived.useQuery(
    { projectId: activeProjectId },
    { enabled: showArchived && Boolean(currentProject), retry: false }
  );
  const access = trpc.project.access.useQuery(
    { projectId: activeProjectId },
    { enabled: Boolean(currentProject) }
  );
  const workflowDetail: any = trpc.workflow.get.useQuery(
    { id: selectedWorkflowId ?? "00000000" },
    { enabled: Boolean(selectedWorkflowId) }
  );
  const workflowAccess = trpc.workflow.access.useQuery(
    { id: selectedWorkflowId ?? "00000000" },
    { enabled: Boolean(selectedWorkflowId), retry: false }
  );
  const exportInput = useMemo(
    () => ({ projectId: activeProjectId, workflowIds: checkedIds }),
    [activeProjectId, checkedIds]
  );
  const exportWorkflows = trpc.project.exportWorkflows.useQuery(exportInput, {
    enabled: false,
    retry: false,
  });
  const canEdit = Boolean(
    access.data?.permissions?.has("project:workflow:edit")
  );
  const canManageSelected = Boolean(
    workflowAccess.data?.permissions?.has("workflow:members:manage")
  );
  const folders = (warehouse.data?.folders ?? []) as Folder[];
  const workflows = (warehouse.data?.workflows ?? []) as WarehouseWorkflow[];
  const restorableWorkflows = (
    (archivedWorkflows.data ?? []) as unknown as ArchivedWorkflow[]
  ).filter(workflow => workflow.projectId === activeProjectId);
  const selectedFolder =
    folders.find(folder => folder.id === selectedFolderId) ?? null;
  const scoped = selectedFolderId
    ? workflows.filter(workflow => workflow.folderId === selectedFolderId)
    : workflows.filter(workflow => !workflow.folderId);
  const visibleWorkflows = scoped.filter(workflow =>
    `${workflow.name} ${workflow.description ?? ""} ${workflow.flowType}`
      .toLowerCase()
      .includes(keyword.trim().toLowerCase())
  );
  const rawChildren = (parentId: string | null) =>
    folders.filter(folder => (folder.parentId ?? null) === parentId);
  const hasFolderMatch = (folder: Folder): boolean =>
    !keyword.trim() ||
    folder.name.toLowerCase().includes(keyword.trim().toLowerCase()) ||
    rawChildren(folder.id).some(hasFolderMatch);
  const children = (parentId: string | null) =>
    rawChildren(parentId).filter(hasFolderMatch);
  const invalidate = () => {
    void utils.project.warehouse.invalidate({ projectId: activeProjectId });
    void utils.workflow.archived.invalidate({ projectId: activeProjectId });
  };
  const createFolder = trpc.project.createFolder.useMutation({
    onSuccess: () => {
      invalidate();
      setFolderDialog(null);
      setFolderDialogName("");
      toast.success("仓库目录已创建。");
    },
    onError: error => toast.error(error.message),
  });
  const updateFolder = trpc.project.updateFolder.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("目录说明已更新。");
    },
    onError: error => toast.error(error.message),
  });
  const deleteFolder = trpc.project.deleteFolder.useMutation({
    onSuccess: () => {
      invalidate();
      setSelectedFolderId(null);
      setDeleteTarget(null);
      toast.success("空目录已删除。");
    },
    onError: error => toast.error(error.message),
  });
  const moveWorkflow = trpc.project.moveWorkflow.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("流程已移动至目标目录。");
    },
    onError: error => toast.error(error.message),
  });
  const createWorkflow = trpc.project.createWorkflow.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("流程已导入并处于待审核状态。");
    },
    onError: error => toast.error(error.message),
  });
  const deleteWorkflow = trpc.workflow.delete.useMutation({
    onSuccess: (_result, input) => {
      invalidate();
      setSelectedWorkflowId(null);
      setCheckedIds(current => current.filter(id => id !== input.id));
      setDeleteTarget(null);
      toast.success("流程已归档，可在归档列表中恢复。");
    },
    onError: error => toast.error(error.message),
  });
  const restoreWorkflow = trpc.workflow.restore.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("流程已恢复到流程仓库。");
    },
    onError: error => toast.error(error.message),
  });

  const download = (name: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const exportSelected = async () => {
    if (!checkedIds.length) return toast.error("请至少勾选一个流程后导出。");
    const result = await exportWorkflows.refetch();
    if (result.error) return toast.error(result.error.message);
    download(`${currentProject?.code ?? "workflow"}-仓库导出.json`, {
      exportedAt: new Date().toISOString(),
      project: { code: currentProject?.code, name: currentProject?.name },
      workflows: result.data,
    });
    toast.success(`已导出 ${result.data?.length ?? 0} 个流程。`);
    setBatchMenuOpen(false);
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentProject) return;
    try {
      const parsed = JSON.parse(await file.text());
      const items = Array.isArray(parsed.workflows)
        ? parsed.workflows
        : [parsed.workflow ?? parsed];
      for (const item of items) {
        const definition = item.definition ?? item.workflow?.definition;
        const flowType = ["state", "control", "data"].includes(item.flowType)
          ? item.flowType
          : "state";
        if (!definition?.nodes || !definition?.edges)
          throw new Error("导入文件缺少流程定义。");
        if (flowType === "data")
          throw new Error(
            "数据流程不支持从流程仓库导入，请在数据资源中心独立设计和运行。"
          );
        await createWorkflow.mutateAsync({
          projectId: currentProject.id,
          processCode:
            typeof item.processCode === "string" ? item.processCode : undefined,
          name: String(item.name ?? item.workflow?.name ?? "导入流程"),
          description:
            typeof item.description === "string" ? item.description : undefined,
          flowType,
          creationSource: "warehouse",
          folderId: selectedFolderId,
          definition,
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "导入文件不是有效的流程仓库 JSON。"
      );
    } finally {
      event.target.value = "";
    }
  };
  const openFolderDialog = (
    mode: NonNullable<FolderDialog>["mode"],
    target: Folder
  ) => {
    setFolderDialog({ mode, target });
    setFolderDialogName("");
  };
  const submitFolderDialog = () => {
    if (!folderDialog || !folderDialogName.trim()) return;
    createFolder.mutate({
      projectId: activeProjectId,
      name: folderDialogName.trim(),
      parentId:
        folderDialog.mode === "selected"
          ? selectedFolderId
          : folderDialog.mode === "sibling"
            ? (folderDialog.target.parentId ?? null)
            : folderDialog.target.id,
    });
  };
  const exportCurrent = () => {
    if (!workflowDetail.data) return;
    download(`${workflowDetail.data.name || "workflow"}.json`, {
      exportedAt: new Date().toISOString(),
      project: { code: currentProject.code, name: currentProject.name },
      workflows: [workflowDetail.data],
    });
    toast.success("已导出当前流程。");
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "folder")
      deleteFolder.mutate({
        projectId: activeProjectId,
        folderId: deleteTarget.folder.id,
      });
    else deleteWorkflow.mutate({ id: deleteTarget.workflow.id });
  };

  if (!currentProject)
    return (
      <div className="min-h-[calc(100vh-56px)] bg-[#f5f7fb] p-4 sm:p-6">
        <div className="grid min-h-80 place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
          暂无可访问项目；请先在流程设计中创建或加入一个业务项目。
        </div>
      </div>
    );

  return (
    <div
      data-aiflow-warehouse=""
      className="min-h-[calc(100vh-56px)] bg-[#f5f7fb] p-4 sm:p-6"
    >
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-[.16em] text-[#5b72a8]">
              PROCESS WAREHOUSE
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-800">
              流程仓库
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              在项目目录树中检索、归档、预览、批量导入和导出状态、控制与数据流程。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowArchived(value => !value)}
            >
              <ArchiveRestore size={14} />
              {showArchived ? "返回流程仓库" : "查看归档流程"}
            </Button>
            <select
              className="h-9 min-w-48 rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={currentProject.id}
              onChange={event => {
                setProjectId(event.target.value);
                setSelectedFolderId(null);
                setSelectedWorkflowId(null);
                setCheckedIds([]);
                setKeyword("");
              }}
            >
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {showArchived ? (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-4">
              <h2 className="font-semibold text-slate-700">可恢复归档流程</h2>
              <p className="mt-1 text-xs text-slate-400">
                归档不会删除版本、运行和审计记录；存在活动运行的流程不能归档。
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {restorableWorkflows.map(workflow => (
                <div
                  key={workflow.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {workflow.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {workflow.description || "未填写流程简介"} · 归档于{" "}
                      {workflow.archivedAt
                        ? new Date(workflow.archivedAt).toLocaleString(
                            "zh-CN",
                            { hour12: false }
                          )
                        : "—"}
                    </p>
                  </div>
                  {workflow.canRestore ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={restoreWorkflow.isPending}
                      onClick={() =>
                        restoreWorkflow.mutate({ id: workflow.id })
                      }
                    >
                      <ArchiveRestore size={14} />
                      恢复流程
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">
                      仅流程所有者或管理员可恢复
                    </span>
                  )}
                </div>
              ))}
              {!archivedWorkflows.isLoading && !restorableWorkflows.length && (
                <div className="p-10 text-center text-sm text-slate-400">
                  当前项目暂无可恢复归档流程。
                </div>
              )}
            </div>
          </section>
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_430px]">
              <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-700">
                      流程列表
                    </p>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setFolderDialog({ mode: "selected" });
                          setFolderDialogName("");
                        }}
                      >
                        <FolderPlus size={14} />
                        新增目录
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Search
                        size={14}
                        className="absolute left-2.5 top-2.5 text-slate-400"
                      />
                      <Input
                        className="h-9 pl-8 text-xs"
                        placeholder="请输入搜索内容"
                        value={keyword}
                        onChange={event => setKeyword(event.target.value)}
                      />
                    </div>
                    <div className="relative">
                      <Button
                        type="button"
                        size="icon"
                        className="h-9 w-9"
                        title="批量操作"
                        disabled={!canEdit}
                        onClick={() => setBatchMenuOpen(value => !value)}
                      >
                        <MoreHorizontal size={16} />
                      </Button>
                      {batchMenuOpen && (
                        <div className="absolute right-0 z-20 mt-1 w-32 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-slate-50"
                            onClick={() => importRef.current?.click()}
                          >
                            <Upload size={13} />
                            批量导入
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                            disabled={!checkedIds.length}
                            onClick={() => void exportSelected()}
                          >
                            <Download size={13} />
                            批量导出
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="max-h-[620px] overflow-y-auto p-2">
                  <button
                    className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${!selectedFolderId ? "bg-[#eaf1ff] text-[#245fc8]" : "text-slate-600 hover:bg-slate-50"}`}
                    onClick={() => setSelectedFolderId(null)}
                  >
                    <ArchiveRestore size={15} />
                    根目录{" "}
                    <span className="ml-auto text-xs text-slate-400">
                      {workflows.filter(workflow => !workflow.folderId).length}
                    </span>
                  </button>
                  {children(null).map(folder => (
                    <FolderTree
                      key={folder.id}
                      folder={folder}
                      level={0}
                      childrenOf={children}
                      selectedId={selectedFolderId}
                      onSelect={setSelectedFolderId}
                      canEdit={canEdit}
                      onAddSibling={folder =>
                        openFolderDialog("sibling", folder)
                      }
                      onAddChild={folder => openFolderDialog("child", folder)}
                      onDelete={folder =>
                        setDeleteTarget({ kind: "folder", folder })
                      }
                    />
                  ))}
                </div>
              </aside>
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      {selectedFolder?.name ?? "根目录流程"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      勾选流程后可批量导出；选择一条流程在右侧查看简介和只读画布。
                    </p>
                  </div>
                  {selectedFolderId && canEdit && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-xs text-[#2d6bea] hover:underline"
                        onClick={() => {
                          const description = window.prompt(
                            "目录说明",
                            selectedFolder?.description ?? ""
                          );
                          if (description !== null && selectedFolder)
                            updateFolder.mutate({
                              projectId: activeProjectId,
                              folderId: selectedFolder.id,
                              description,
                            });
                        }}
                      >
                        编辑简介
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() =>
                          selectedFolder &&
                          setDeleteTarget({
                            kind: "folder",
                            folder: selectedFolder,
                          })
                        }
                      >
                        删除目录
                      </button>
                    </div>
                  )}
                </div>
                <div className="divide-y divide-slate-100">
                  {visibleWorkflows.map(workflow => (
                    <div
                      key={workflow.id}
                      className={`flex items-center gap-3 p-3 transition-colors ${selectedWorkflowId === workflow.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`选择${workflow.name}`}
                        checked={checkedIds.includes(workflow.id)}
                        onChange={() =>
                          setCheckedIds(current =>
                            current.includes(workflow.id)
                              ? current.filter(id => id !== workflow.id)
                              : current.concat(workflow.id)
                          )
                        }
                      />
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setSelectedWorkflowId(workflow.id)}
                      >
                        <div className="flex items-center gap-2">
                          <FileJson size={15} className="text-[#2d6bea]" />
                          <p className="truncate text-sm font-medium text-slate-800">
                            {workflow.name}
                          </p>
                          <FlowBadge type={workflow.flowType} />
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-400">
                          {workflow.description || "未填写流程简介"} · v
                          {workflow.definitionVersion}
                        </p>
                      </button>
                      {canManageSelected &&
                        selectedWorkflowId === workflow.id && (
                          <select
                            aria-label="移动流程目录"
                            className="h-7 max-w-28 rounded border border-slate-200 bg-white px-1 text-[11px]"
                            value={workflow.folderId ?? ""}
                            onChange={event =>
                              moveWorkflow.mutate({
                                projectId: activeProjectId,
                                workflowId: workflow.id,
                                folderId: event.target.value || null,
                              })
                            }
                          >
                            <option value="">根目录</option>
                            {folders.map(folder => (
                              <option key={folder.id} value={folder.id}>
                                {folder.name}
                              </option>
                            ))}
                          </select>
                        )}
                      {canEdit && (
                        <button
                          type="button"
                          className="rounded p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-700"
                          title="归档流程"
                          aria-label={`归档流程 ${workflow.name}`}
                          onClick={() =>
                            setDeleteTarget({ kind: "workflow", workflow })
                          }
                        >
                          <ArchiveRestore size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {!visibleWorkflows.length && (
                    <div className="grid min-h-64 place-items-center p-8 text-center">
                      <div>
                        <FolderClosed
                          className="mx-auto text-slate-300"
                          size={30}
                        />
                        <p className="mt-3 text-sm text-slate-400">
                          {keyword ? "没有搜到任何数据" : "该目录暂无流程。"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>
              <aside className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 p-3">
                  <p className="text-sm font-semibold text-slate-700">
                    流程简介
                  </p>
                  <span className="text-[11px] text-slate-400">流程图</span>
                </div>
                {workflowDetail.data ? (
                  <div>
                    <div className="border-b border-slate-100 p-3">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                          {workflowDetail.data.name}
                        </p>
                        <FlowBadge type={workflowDetail.data.flowType} />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        {workflowDetail.data.description || "未填写流程简介"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          className="h-7 text-xs"
                          size="sm"
                          onClick={() =>
                            onOpenWorkflow(
                              currentProject,
                              workflowDetail.data.id
                            )
                          }
                        >
                          打开设计器
                        </Button>
                        <Button
                          className="h-7 text-xs"
                          variant="outline"
                          size="sm"
                          onClick={exportCurrent}
                        >
                          <Download size={12} />
                          导出流程
                        </Button>
                        <span className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 px-2 text-[11px] text-slate-500">
                          <Image size={12} />
                          全屏与图片工具位于预览画布
                        </span>
                      </div>
                    </div>
                    <div className="h-[470px]">
                      <WorkflowCanvas
                        workflowId={workflowDetail.data.id}
                        definition={workflowDetail.data.definition}
                        readOnly
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid h-[560px] place-items-center p-8 text-center text-sm leading-6 text-slate-400">
                    <div>
                      <FolderClosed
                        className="mx-auto text-slate-300"
                        size={30}
                      />
                      <p className="mt-3">
                        从中间列表选择一条流程，查看流程简介、版本信息与只读流程图。
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2 text-[11px]">
                        <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
                          取消高亮
                        </span>
                        <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
                          整理画布
                        </span>
                        <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
                          保存为图片
                        </span>
                        <span className="rounded border border-slate-200 px-2 py-1 text-slate-300">
                          全屏
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </aside>
            </div>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={importFile}
            />
          </>
        )}
        <Dialog
          open={Boolean(folderDialog)}
          onOpenChange={open => {
            if (!open) setFolderDialog(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {folderDialog?.mode === "sibling"
                  ? "新增同级文件夹"
                  : folderDialog?.mode === "selected" && !selectedFolderId
                    ? "新增根文件夹"
                    : "新增子级文件夹"}
              </DialogTitle>
              <DialogDescription>
                文件夹仅在当前受权业务项目中创建，不会改变其他项目的仓库目录。
              </DialogDescription>
            </DialogHeader>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              文件夹名称
              <Input
                autoFocus
                maxLength={160}
                placeholder="请输入文件夹名称"
                value={folderDialogName}
                onChange={event => setFolderDialogName(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFolderDialog(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={!folderDialogName.trim() || createFolder.isPending}
                onClick={submitFolderDialog}
              >
                <FolderPlus size={14} />
                确认新增
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(deleteTarget)}
          onOpenChange={open => {
            if (!open) setDeleteTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {deleteTarget?.kind === "folder"
                  ? "确认删除目录"
                  : "确认归档流程"}
              </DialogTitle>
              <DialogDescription>
                {deleteTarget?.kind === "folder"
                  ? `将删除空目录“${deleteTarget.folder.name}”。含有子目录或流程的目录会被服务端拒绝删除。`
                  : `将归档流程“${deleteTarget?.kind === "workflow" ? deleteTarget.workflow.name : ""}”。版本、运行、任务、成员授权和审计记录均会保留，之后可从归档列表恢复。`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant={
                  deleteTarget?.kind === "folder" ? "destructive" : "default"
                }
                disabled={deleteFolder.isPending || deleteWorkflow.isPending}
                onClick={confirmDelete}
              >
                {deleteTarget?.kind === "folder" ? (
                  <Trash2 size={14} />
                ) : (
                  <ArchiveRestore size={14} />
                )}
                {deleteTarget?.kind === "folder" ? "确认删除" : "确认归档"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function FolderTree({
  folder,
  level,
  childrenOf,
  selectedId,
  onSelect,
  canEdit,
  onAddSibling,
  onAddChild,
  onDelete,
}: {
  folder: Folder;
  level: number;
  childrenOf: (id: string | null) => Folder[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  canEdit: boolean;
  onAddSibling: (folder: Folder) => void;
  onAddChild: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const children = childrenOf(folder.id);
  return (
    <div>
      <div
        className={`group flex items-center rounded text-sm ${selectedId === folder.id ? "bg-[#eaf1ff] text-[#245fc8]" : "text-slate-600 hover:bg-slate-50"}`}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left"
          style={{ paddingLeft: `${8 + level * 16}px` }}
          onClick={() => onSelect(folder.id)}
        >
          {children.length ? (
            <span
              onClick={event => {
                event.stopPropagation();
                setExpanded(value => !value);
              }}
            >
              {expanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
          ) : (
            <span className="w-3.5" />
          )}
          {expanded ? <FolderOpen size={15} /> : <FolderClosed size={15} />}
          <span className="truncate">{folder.name}</span>
        </button>
        {canEdit && (
          <div className="relative mr-1">
            <button
              type="button"
              aria-label={`${folder.name} 的目录操作`}
              title="目录操作"
              className="rounded p-1 text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover:opacity-100 focus:opacity-100"
              onClick={() => setMenuOpen(value => !value)}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-28 rounded-md border border-slate-200 bg-white p-1 text-xs text-slate-700 shadow-lg">
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-slate-50"
                  onClick={() => {
                    setMenuOpen(false);
                    onAddSibling(folder);
                  }}
                >
                  添加同级
                </button>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-slate-50"
                  onClick={() => {
                    setMenuOpen(false);
                    onAddChild(folder);
                  }}
                >
                  添加子级
                </button>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(folder);
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {expanded &&
        children.map(child => (
          <FolderTree
            key={child.id}
            folder={child}
            level={level + 1}
            childrenOf={childrenOf}
            selectedId={selectedId}
            onSelect={onSelect}
            canEdit={canEdit}
            onAddSibling={onAddSibling}
            onAddChild={onAddChild}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}
