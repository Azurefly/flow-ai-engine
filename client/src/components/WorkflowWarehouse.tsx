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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import WorkflowCanvas from "@/components/WorkflowCanvas";
import { trpc } from "@/lib/trpc";
import {
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Download,
  FileJson,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { searchSelectOptions } from "../../../shared/search-select";
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

type ImportResult = {
  index: number;
  name: string;
  success: boolean;
  message: string;
};

const displayWorkflowName = (name: string) => name.replaceAll("_", "_\u200b");

function FlowBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    state: "bg-aiflow-info-surface text-aiflow-info",
    control: "bg-aiflow-special-surface text-aiflow-special",
    data: "bg-aiflow-success-surface text-aiflow-success",
  };
  const labels: Record<string, string> = {
    state: "状态",
    control: "控制",
    data: "数据",
  };
  return (
    <span
      className={`aiflow-type-meta rounded px-1.5 py-0.5 ${styles[type] ?? "bg-muted text-muted-foreground"}`}
    >
      {labels[type] ?? type}
    </span>
  );
}

export default function WorkflowWarehouse({
  projects,
  projectsLoading,
  projectsError,
  onRetryProjects,
  onOpenWorkflow,
}: {
  projects: ProjectRecord[];
  projectsLoading: boolean;
  projectsError: boolean;
  onRetryProjects: () => void;
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
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const workflowRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const workflowPreviewRef = useRef<HTMLElement | null>(null);
  const returnToWorkflowListRef = useRef<HTMLButtonElement | null>(null);
  const previousSelectedWorkflowId = useRef<string | null>(selectedWorkflowId);
  const currentProject =
    projects.find(project => project.id === projectId) ?? projects[0] ?? null;
  const projectOptions = useMemo(
    () =>
      projects.map(project => ({
        value: project.id,
        label: `${project.code} · ${project.name}`,
        keywords: `${project.code} ${project.name}`,
      })),
    [projects]
  );
  const projectSearch = useMemo(
    () => searchSelectOptions(projectOptions, projectQuery, 50),
    [projectOptions, projectQuery]
  );
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
  useEffect(() => {
    const previousId = previousSelectedWorkflowId.current;
    let frame: number | undefined;
    if (window.matchMedia("(max-width: 1279px)").matches) {
      frame = window.requestAnimationFrame(() => {
        if (selectedWorkflowId) {
          workflowPreviewRef.current?.scrollIntoView({ block: "start" });
          returnToWorkflowListRef.current?.focus({ preventScroll: true });
        } else if (previousId) {
          const previousRow = workflowRowRefs.current.get(previousId);
          previousRow?.scrollIntoView({ block: "center" });
          previousRow?.focus({ preventScroll: true });
        }
      });
    }
    previousSelectedWorkflowId.current = selectedWorkflowId;
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [selectedWorkflowId]);
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

  if (projectsLoading && !projects.length)
    return (
      <div className="min-h-[calc(100vh-56px)] bg-background p-4 sm:p-6">
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-80 items-center justify-center gap-2 rounded-lg border border-border bg-card p-8 text-sm text-muted-foreground"
        >
          <Loader2 size={16} className="animate-spin" />
          正在读取当前账号可见的业务项目…
        </div>
      </div>
    );

  if (projectsError && !projects.length)
    return (
      <div className="min-h-[calc(100vh-56px)] bg-background p-4 sm:p-6">
        <div
          role="alert"
          className="grid min-h-80 place-items-center rounded-lg border border-aiflow-danger-border bg-card p-8 text-center"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">
              业务列表暂时无法加载
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              这不代表当前没有可访问的业务项目。请检查连接后重试。
            </p>
            <Button type="button" className="mt-4" onClick={onRetryProjects}>
              <RotateCcw size={14} />
              重试
            </Button>
          </div>
        </div>
      </div>
    );

  if (!currentProject)
    return (
      <div className="min-h-[calc(100vh-56px)] bg-background p-4 sm:p-6">
        <div className="grid min-h-80 place-items-center rounded-lg border border-dashed border-input bg-card p-10 text-center text-sm text-muted-foreground">
          暂无可访问项目；请先在流程设计中创建或加入一个业务项目。
        </div>
      </div>
    );

  return (
    <div
      data-aiflow-warehouse=""
      className="min-h-[calc(100vh-56px)] bg-background p-4 sm:p-6"
    >
      <div>
        <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="aiflow-type-meta font-bold tracking-[.16em] text-muted-foreground">
              PROCESS WAREHOUSE
            </p>
            <h1 className="aiflow-type-page-title mt-1 font-semibold text-foreground">
              流程仓库
            </h1>
            <p className="aiflow-type-body mt-1 text-muted-foreground">
              在项目目录树中检索、归档、预览、批量导入和导出状态、控制流程；数据流请前往数据资源中心管理。
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="aiflow-type-control h-11 min-h-11 min-[1024px]:h-9 min-[1024px]:min-h-0"
              onClick={() => setShowArchived(value => !value)}
            >
              <ArchiveRestore size={14} />
              {showArchived ? "返回流程仓库" : "查看归档流程"}
            </Button>
            <Popover
              open={projectSelectorOpen}
              onOpenChange={open => {
                setProjectSelectorOpen(open);
                if (!open) setProjectQuery("");
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-label={`切换流程仓库项目，当前：${currentProject.code} · ${currentProject.name}`}
                  aria-expanded={projectSelectorOpen}
                  className="h-11 w-full justify-between gap-2 px-3 text-left font-normal sm:w-80"
                  title={`${currentProject.code} · ${currentProject.name}`}
                >
                  <span className="min-w-0 truncate">
                    {currentProject.code} · {currentProject.name}
                  </span>
                  <ChevronsUpDown
                    size={16}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="max-w-[calc(100vw-2rem)] p-0"
                style={{ width: "var(--radix-popover-trigger-width)" }}
              >
                <Command shouldFilter={false}>
                  <CommandInput
                    aria-label="搜索仓库项目"
                    placeholder="输入项目名称或代号搜索"
                    value={projectQuery}
                    onValueChange={setProjectQuery}
                  />
                  <CommandList>
                    {projectSearch.totalMatches === 0 ? (
                      <CommandEmpty>
                        没有匹配的项目，请更换搜索词。
                      </CommandEmpty>
                    ) : (
                      <CommandGroup
                        heading={`匹配 ${projectSearch.totalMatches} 个项目`}
                      >
                        {projectSearch.options.map(option => (
                          <CommandItem
                            key={option.value}
                            value={option.value}
                            onSelect={() => {
                              setProjectId(option.value);
                              setSelectedFolderId(null);
                              setSelectedWorkflowId(null);
                              setCheckedIds([]);
                              setKeyword("");
                              setProjectSelectorOpen(false);
                              setProjectQuery("");
                            }}
                            className="min-h-11"
                          >
                            <Check
                              size={16}
                              className={
                                option.value === currentProject.id
                                  ? "opacity-100"
                                  : "opacity-0"
                              }
                              aria-hidden="true"
                            />
                            <span
                              className="min-w-0 truncate"
                              title={option.label}
                            >
                              {option.label}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                  {projectSearch.hasMore && (
                    <p className="aiflow-type-body border-t px-3 py-2 text-muted-foreground">
                      显示前 50 个匹配项目；继续输入名称或代号以缩小范围。
                    </p>
                  )}
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {projectsError && projects.length > 0 && (
          <div
            role="status"
            className="aiflow-type-body mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface px-4 py-2 text-amber-900"
          >
            <span>刷新失败，当前显示上次成功读取的业务项目列表。</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 border-amber-300 bg-card text-xs text-amber-900"
              onClick={onRetryProjects}
            >
              重试
            </Button>
          </div>
        )}
        {warehouse.isError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-4 text-sm text-aiflow-danger"
          >
            <div>
              <p className="font-semibold">流程仓库加载失败</p>
              <p className="aiflow-type-body mt-1 break-words text-aiflow-danger">
                {warehouse.error.message}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void warehouse.refetch()}
            >
              <RotateCcw size={14} />
              重试
            </Button>
          </div>
        )}
        {warehouse.isLoading && (
          <div
            role="status"
            className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
          >
            <Loader2 size={16} className="animate-spin" />
            正在读取流程仓库…
          </div>
        )}
        {showArchived ? (
          <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="border-b border-border p-4">
              <h2 className="font-semibold text-foreground">可恢复归档流程</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                归档不会删除版本、运行和审计记录；存在活动运行的流程不能归档。
              </p>
            </div>
            <div className="divide-y divide-border">
              {archivedWorkflows.isError && (
                <div role="alert" className="p-8 text-center">
                  <p className="text-sm font-semibold text-foreground">
                    归档流程加载失败
                  </p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {archivedWorkflows.error.message}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void archivedWorkflows.refetch()}
                  >
                    <RotateCcw size={14} />
                    重试
                  </Button>
                </div>
              )}
              {archivedWorkflows.isLoading && (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"
                >
                  <Loader2 size={16} className="animate-spin" />
                  正在读取归档流程…
                </div>
              )}
              {!archivedWorkflows.isLoading &&
                !archivedWorkflows.isError &&
                restorableWorkflows.map(workflow => (
                  <div
                    key={workflow.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div className="min-w-0">
                      <p
                        aria-label={workflow.name}
                        className="aiflow-type-body break-words font-medium text-foreground"
                        title={workflow.name}
                      >
                        {displayWorkflowName(workflow.name)}
                      </p>
                      <p className="aiflow-type-body mt-1 text-muted-foreground">
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
                      <span className="text-sm text-muted-foreground">
                        仅流程所有者或管理员可恢复
                      </span>
                    )}
                  </div>
                ))}
              {!archivedWorkflows.isLoading &&
                !archivedWorkflows.isError &&
                !restorableWorkflows.length && (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    当前项目暂无可恢复归档流程。
                  </div>
                )}
            </div>
          </section>
        ) : (
          <>
            <div
              className={`grid gap-4 ${selectedWorkflowId ? "xl:grid-cols-[240px_minmax(280px,1fr)_minmax(500px,1.35fr)]" : "xl:grid-cols-[240px_minmax(0,1fr)]"}`}
            >
              <aside
                className={`overflow-hidden rounded-lg border border-border bg-card shadow-sm ${selectedWorkflowId ? "hidden xl:block" : ""}`}
              >
                <div className="border-b border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="aiflow-type-section-title font-semibold text-foreground">
                      流程列表
                    </h2>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="aiflow-type-control h-11 min-h-11 min-[1024px]:h-9 min-[1024px]:min-h-0"
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
                        className="absolute left-2.5 top-2.5 text-muted-foreground"
                      />
                      <Input
                        className="aiflow-type-control h-11 min-h-11 pl-8 min-[1024px]:h-9 min-[1024px]:min-h-0"
                        placeholder="请输入搜索内容"
                        aria-label="搜索当前目录中的流程"
                        value={keyword}
                        onChange={event => setKeyword(event.target.value)}
                      />
                    </div>
                    <div className="relative">
                      <Button
                        type="button"
                        size="sm"
                        className="aiflow-type-control h-11 min-h-11 gap-1 px-2 min-[1024px]:h-9 min-[1024px]:min-h-0"
                        aria-label="批量操作"
                        aria-expanded={batchMenuOpen}
                        title="批量操作"
                        disabled={!canEdit}
                        onClick={() => setBatchMenuOpen(value => !value)}
                      >
                        <MoreHorizontal size={16} />
                        批量
                      </Button>
                      {batchMenuOpen && (
                        <div className="absolute right-0 z-20 mt-1 w-32 rounded-md border border-border bg-card p-1 shadow-lg">
                          <button
                            type="button"
                            className="aiflow-type-control flex min-h-11 w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted"
                            onClick={() => importRef.current?.click()}
                          >
                            <Upload size={13} />
                            批量导入
                          </button>
                          <button
                            type="button"
                            className="aiflow-type-control flex min-h-11 w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:text-slate-300"
                            disabled={!checkedIds.length}
                            onClick={() => void exportSelected()}
                          >
                            <Download size={13} />
                            {checkedIds.length
                              ? `批量导出 (${checkedIds.length})`
                              : "批量导出"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="max-h-[620px] overflow-y-auto p-2">
                  <button
                    className={`flex min-h-11 w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${!selectedFolderId ? "bg-accent text-aiflow-info" : "text-muted-foreground hover:bg-muted"}`}
                    onClick={() => setSelectedFolderId(null)}
                  >
                    <ArchiveRestore size={15} />
                    根目录{" "}
                    <span className="aiflow-type-meta ml-auto text-muted-foreground">
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
              <section
                className={`overflow-hidden rounded-lg border border-border bg-card shadow-sm ${selectedWorkflowId ? "hidden xl:block" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-3">
                  <div>
                    <h2 className="aiflow-type-section-title font-semibold text-foreground">
                      {selectedFolder?.name ?? "根目录流程"}
                    </h2>
                    <p className="aiflow-type-body mt-1 text-muted-foreground">
                      勾选后可批量导出；点击流程可查看简介和只读画布。
                    </p>
                  </div>
                  {selectedFolderId && canEdit && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="aiflow-type-control min-h-11 text-aiflow-info hover:underline min-[1024px]:min-h-9"
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
                        className="aiflow-type-control min-h-11 text-red-600 hover:underline min-[1024px]:min-h-9"
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
                <div className="divide-y divide-border">
                  {visibleWorkflows.map(workflow => (
                    <div
                      key={workflow.id}
                      className={`flex items-start gap-1.5 p-2 transition-colors sm:gap-3 sm:p-3 ${selectedWorkflowId === workflow.id ? "bg-aiflow-info-surface" : "hover:bg-muted"}`}
                    >
                      <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-blue-600"
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
                      </label>
                      <button
                        ref={node => {
                          if (node)
                            workflowRowRefs.current.set(workflow.id, node);
                          else workflowRowRefs.current.delete(workflow.id);
                        }}
                        className="min-w-0 flex-1 py-1 text-left"
                        aria-label={`查看流程 ${workflow.name}`}
                        title={workflow.name}
                        onClick={() => setSelectedWorkflowId(workflow.id)}
                      >
                        <div className="flex items-start gap-1.5 sm:gap-2">
                          <FileJson
                            size={15}
                            className="mt-0.5 shrink-0 text-aiflow-info"
                          />
                          <p className="aiflow-type-card-title min-w-0 break-words font-semibold leading-6 text-foreground">
                            {displayWorkflowName(workflow.name)}
                          </p>
                        </div>
                        <p
                          className="aiflow-type-body mt-1 line-clamp-2 break-words text-muted-foreground"
                          title={workflow.description || "未填写流程简介"}
                        >
                          {workflow.description || "未填写流程简介"}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <FlowBadge type={workflow.flowType} />
                          <span className="aiflow-type-meta rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                            v{workflow.definitionVersion}
                          </span>
                        </div>
                      </button>
                      {canManageSelected &&
                        selectedWorkflowId === workflow.id && (
                          <select
                            aria-label="移动流程目录"
                            className="aiflow-type-control h-11 min-h-11 max-w-40 rounded border border-border bg-card px-2 min-[1024px]:h-9 min-[1024px]:min-h-0"
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
                          className="aiflow-type-control inline-flex h-11 min-h-11 shrink-0 items-center gap-1 rounded px-2 text-muted-foreground hover:bg-aiflow-warning-surface hover:text-aiflow-warning min-[1024px]:h-9 min-[1024px]:min-h-0"
                          title={`归档流程 ${workflow.name}`}
                          aria-label={`归档流程 ${workflow.name}`}
                          onClick={() =>
                            setDeleteTarget({ kind: "workflow", workflow })
                          }
                        >
                          <ArchiveRestore size={15} />
                          <span>归档</span>
                        </button>
                      )}
                    </div>
                  ))}
                  {!warehouse.isLoading &&
                    !warehouse.isError &&
                    !visibleWorkflows.length && (
                      <div className="grid min-h-64 place-items-center p-8 text-center">
                        <div>
                          <FolderClosed
                            className="mx-auto text-slate-300"
                            size={30}
                          />
                          <p className="mt-3 text-sm text-muted-foreground">
                            {keyword ? "没有搜到任何数据" : "该目录暂无流程。"}
                          </p>
                        </div>
                      </div>
                    )}
                </div>
              </section>
              {selectedWorkflowId && (
                <aside
                  ref={workflowPreviewRef}
                  className="scroll-mt-14 flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
                >
                  <div className="flex items-center justify-between border-b border-border p-3">
                    <p className="aiflow-type-section-title font-semibold text-foreground">
                      流程简介
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="aiflow-type-meta text-muted-foreground">
                        只读流程图
                      </span>
                      <button
                        type="button"
                        ref={returnToWorkflowListRef}
                        aria-label="返回流程列表"
                        className="aiflow-type-control inline-flex min-h-11 items-center gap-1 rounded px-2 text-muted-foreground hover:bg-muted xl:hidden"
                        onClick={() => setSelectedWorkflowId(null)}
                        title="返回流程列表"
                      >
                        <ChevronLeft size={14} />
                        返回列表
                      </button>
                      <button
                        type="button"
                        aria-label="收起预览"
                        className="hidden rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground xl:inline-flex"
                        onClick={() => setSelectedWorkflowId(null)}
                        title="收起预览"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {workflowDetail.data ? (
                    <div>
                      <div className="border-b border-border p-3">
                        <div className="flex items-start gap-2">
                          <p
                            aria-label={workflowDetail.data.name}
                            className="aiflow-type-card-title min-w-0 flex-1 break-words font-semibold leading-6 text-foreground"
                            title={workflowDetail.data.name}
                          >
                            {displayWorkflowName(workflowDetail.data.name)}
                          </p>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <FlowBadge type={workflowDetail.data.flowType} />
                            <span className="aiflow-type-meta rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                              v{workflowDetail.data.definitionVersion}
                            </span>
                          </div>
                        </div>
                        <p className="aiflow-type-body mt-2 line-clamp-4 break-words text-muted-foreground">
                          {workflowDetail.data.description || "未填写流程简介"}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            className="aiflow-type-control h-11 min-h-11 min-[1024px]:h-9 min-[1024px]:min-h-0"
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
                            className="aiflow-type-control h-11 min-h-11 min-[1024px]:h-9 min-[1024px]:min-h-0"
                            variant="outline"
                            size="sm"
                            onClick={exportCurrent}
                          >
                            <Download size={12} />
                            导出流程
                          </Button>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <WorkflowCanvas
                          workflowId={workflowDetail.data.id}
                          definition={workflowDetail.data.definition}
                          readOnly
                          compactReadOnlyPreview
                        />
                      </div>
                    </div>
                  ) : workflowDetail.isLoading ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="grid h-[560px] place-items-center p-8 text-center text-sm leading-6 text-muted-foreground"
                    >
                      <div>
                        <Loader2
                          className="mx-auto animate-spin text-aiflow-info"
                          size={24}
                          aria-hidden="true"
                        />
                        <p className="mt-3">正在读取所选流程简介和只读画布…</p>
                      </div>
                    </div>
                  ) : workflowDetail.isError ? (
                    <div
                      role="alert"
                      className="grid h-[560px] place-items-center p-8 text-center text-sm leading-6 text-muted-foreground"
                    >
                      <div>
                        <FolderClosed
                          className="mx-auto text-slate-300"
                          size={30}
                          aria-hidden="true"
                        />
                        <p className="mt-3">
                          暂时无法读取所选流程详情，请重试。
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-4 min-h-11"
                          onClick={() => void workflowDetail.refetch()}
                        >
                          重试读取流程详情
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid h-[560px] place-items-center p-8 text-center text-sm leading-6 text-muted-foreground">
                      <div>
                        <FolderClosed
                          className="mx-auto text-slate-300"
                          size={30}
                          aria-hidden="true"
                        />
                        <p className="mt-3">
                          未能取得所选流程的详情，请返回列表重新选择。
                        </p>
                      </div>
                    </div>
                  )}
                </aside>
              )}
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
            <label className="grid gap-2 text-sm font-medium text-foreground">
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
        className={`group flex items-center rounded text-sm ${selectedId === folder.id ? "bg-accent text-aiflow-info" : "text-muted-foreground hover:bg-muted"}`}
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
              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-card hover:text-foreground group-hover:opacity-100 focus:opacity-100"
              onClick={() => setMenuOpen(value => !value)}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-28 rounded-md border border-border bg-card p-1 text-xs text-foreground shadow-lg">
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => {
                    setMenuOpen(false);
                    onAddSibling(folder);
                  }}
                >
                  添加同级
                </button>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-muted"
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
