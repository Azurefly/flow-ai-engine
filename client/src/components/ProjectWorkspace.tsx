import { workflowReviewSnapshot } from "@shared/workflow-review-snapshot";
import { roleExpiryInput } from "@shared/role-expiry";
import { projectCapabilities } from "@shared/project-capabilities";
import { canRevokeProjectGrant } from "@shared/project-member-grant";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import { AuthorizationDetailRefresh } from "./AuthorizationDetailRefresh";
import { ResourceEditContext } from "@/contexts/ResourceEditContext";
import { useResourceDraftState, useResourceDraftPending, useResourceDraftSummary, ResourceDraftRecoveryNotice } from "./ResourceDraftSession";
import { PermissionListFeedback } from "./PermissionListFeedback";
import { consoleNavigationEvent, requestConsoleNavigation, type ConsoleNavigationEvent } from "@/lib/console-navigation-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreationDialog } from "@/components/CreationDialog";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { trpc } from "@/lib/trpc";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Database,
  Download,
  FolderKanban,
  Globe2,
  LayoutList,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  Upload,
  UsersRound,
  Building2,
  Trash2,
} from "lucide-react";
import { type ChangeEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
const DataResourceCenter = lazy(() => import("./DataResourceCenter"));
const ProjectArchiveDialog = lazy(() => import("./ProjectArchiveDialog"));
const WorkflowReviewDialog = lazy(() => import("./WorkflowReviewDialog"));

export type ProjectRecord = {
  id: string;
  status?: "active" | "archived";
  lifecycleVersion?: number;
  canManageArchive?: boolean | number;
  archivedWorkflowCount?: number;
  code: string;
  name: string;
  description?: string | null;
  ownerName?: string | null;
  ownerUsername?: string | null;
  workflowCount?: number;
  createdAt?: string | Date;
  domainId?: string | null;
  domainCode?: string | null;
  domainName?: string | null;
  rootDepartment?: string | null;
};
export type ProjectMemberRole = "owner" | "designer" | "operator" | "viewer";
const projectRoleLabel = (role: string) =>
  (
    ({
      owner: "业务管理员",
      designer: "设计者",
      operator: "运行者",
      viewer: "查看者",
    }) as Record<string, string>
  )[role] ?? role;

const flowTypeLabel = {
  state: "状态流程",
  control: "控制流程",
  data: "数据流程",
} as const;
const flowTypeStyle = {
  state: "bg-aiflow-info-surface text-aiflow-info",
  control: "bg-aiflow-special-surface text-aiflow-special",
  data: "bg-aiflow-success-surface text-aiflow-success",
} as const;
const auditLabel = {
  init: "待审核",
  approved: "审核通过",
  rejected: "审核驳回",
} as const;
const displayFlowType = (value?: string | null) =>
  value
    ? (flowTypeLabel[value as keyof typeof flowTypeLabel] ??
      `未知类型（原值：${value}）`)
    : "未知类型";
const displayAuditStatus = (value?: string | null) =>
  value
    ? (auditLabel[value as keyof typeof auditLabel] ??
      `未知审核状态（原值：${value}）`)
    : "未知审核状态";
const workflowCode = (workflow: any) =>
  workflow.processCode || String(workflow.id).slice(0, 8).toUpperCase();
const getOptionalWorkflowDescription = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const displayWorkflowName = (name: string) => name.replaceAll("_", "_\u200b");
const formatDate = (value?: string | Date | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

export function BusinessCenter({
  canCreate,
  status,
  onStatusChange,
  onOpenProject,
}: {
  canCreate: boolean;
  status: "active" | "archived";
  onStatusChange: (status: "active" | "archived") => void;
  onOpenProject: (project: ProjectRecord) => void;
}) {
  const utils = trpc.useUtils();
  const [filterForm, setFilterForm] = useState({
    keyword: "",
    startDate: "",
    endDate: "",
  });
  const [appliedFilters, setAppliedFilters] = useState({
    keyword: "",
    startDate: "",
    endDate: "",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterError, setFilterError] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<ProjectRecord | null>(null);
  const pageInput = useMemo(() => {
    const end = appliedFilters.endDate ? new Date(`${appliedFilters.endDate}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    return { page, limit: pageSize, search: appliedFilters.keyword, status,
      createdFrom: appliedFilters.startDate ? new Date(`${appliedFilters.startDate}T00:00:00`).toISOString() : undefined,
      createdBefore: end?.toISOString() };
  }, [page, pageSize, appliedFilters, status]);
  const projects = trpc.project.page.useQuery(pageInput);
  const [showCreate, setShowCreate] = useState(false);
  const [unitDirectoryQuery, setUnitDirectoryQuery] = useState("");
  const [userDirectoryQuery, setUserDirectoryQuery] = useState("");
  const [debouncedUnitDirectoryQuery, setDebouncedUnitDirectoryQuery] =
    useState("");
  const [debouncedUserDirectoryQuery, setDebouncedUserDirectoryQuery] =
    useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    domainId: "",
    visibleUserIds: [] as number[],
    visibleUnitIds: [] as string[],
  });
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const csvImportInProgressRef = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedUnitDirectoryQuery(unitDirectoryQuery.trim()),
      250
    );
    return () => window.clearTimeout(timer);
  }, [unitDirectoryQuery]);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedUserDirectoryQuery(userDirectoryQuery.trim()),
      250
    );
    return () => window.clearTimeout(timer);
  }, [userDirectoryQuery]);
  useEffect(() => {
    if (showCreate) return;
    setUnitDirectoryQuery("");
    setUserDirectoryQuery("");
    setDebouncedUnitDirectoryQuery("");
    setDebouncedUserDirectoryQuery("");
  }, [showCreate]);
  const domains = trpc.project.activeDomains.useQuery(undefined, {
    enabled: canCreate && showCreate,
  });
  const activeUnits = trpc.project.searchActiveUnits.useQuery(
    { query: debouncedUnitDirectoryQuery },
    {
      enabled:
        canCreate && showCreate && debouncedUnitDirectoryQuery.length > 0,
    }
  );
  const activeUsers = trpc.project.searchActiveUsers.useQuery(
    { query: debouncedUserDirectoryQuery },
    {
      enabled:
        canCreate && showCreate && debouncedUserDirectoryQuery.length > 0,
    }
  );
  const createProject = trpc.project.create.useMutation({
    onSuccess: () => {
      if (csvImportInProgressRef.current) return;
      void utils.project.invalidate();
      setShowCreate(false);
      setForm({
        code: "",
        name: "",
        description: "",
        domainId: "",
        visibleUserIds: [],
        visibleUnitIds: [],
      });
      toast.success("业务项目已创建，权限隔离已生效。");
    },
    onError: error => {
      if (!csvImportInProgressRef.current) toast.error(error.message);
    },
  });
  const importBusinesses = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (csvImportInProgressRef.current) return;
    csvImportInProgressRef.current = true;
    setImporting(true);
    let importedCount = 0;
    try {
      const lines = (await file.text())
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter(line => line.trim());
      if (!lines.length)
        throw new Error("CSV 文件为空。请使用业务导入模板填写标题行后再导入。");
      const parseRow = (line: string) => {
        const cells: string[] = [];
        let value = "";
        let quoted = false;
        for (let index = 0; index < line.length; index += 1) {
          const character = line[index];
          if (character === '"') {
            if (quoted && line[index + 1] === '"') {
              value += '"';
              index += 1;
            } else quoted = !quoted;
          } else if (character === "," && !quoted) {
            cells.push(value.trim());
            value = "";
          } else value += character;
        }
        cells.push(value.trim());
        return cells;
      };
      const header = parseRow(lines[0]).map(value =>
        value.trim().toLowerCase()
      );
      const column = (...names: string[]) =>
        header.findIndex(value => names.includes(value));
      const codeColumn = column("业务代号", "code");
      const nameColumn = column("业务名称", "name");
      const domainColumn = column("工作域代号", "domaincode");
      const descriptionColumn = column("业务说明", "description");
      if (codeColumn < 0 || nameColumn < 0)
        throw new Error(
          "CSV 标题必须包含“业务代号、业务名称”（或 code、name）。"
        );
      if (lines.length === 1) {
        toast.info("模板中还没有业务记录；填写至少一条记录后再导入。");
        return;
      }
      const imported = lines
        .slice(1)
        .map(parseRow)
        .map(cells => ({
          code: cells[codeColumn]?.toUpperCase() ?? "",
          name: cells[nameColumn] ?? "",
          domainCode: domainColumn >= 0 ? (cells[domainColumn] ?? "") : "",
          description:
            descriptionColumn >= 0 ? (cells[descriptionColumn] ?? "") : "",
        }));
      if (imported.some(item => !item.code || !item.name))
        throw new Error("每条业务记录都需要业务代号和业务名称。");
      const duplicate = imported.find(
        (item, index) =>
          imported.findIndex(other => other.code === item.code) !== index
      );
      if (duplicate)
        throw new Error(`CSV 中存在重复业务代号：${duplicate.code}。`);
      if (imported.length > 500) throw new Error("每次最多导入 500 个业务项目，请分批导入。");
      const existingCodes = new Set(
        await utils.project.existingCodes.fetch({ codes: imported.map(item => item.code) }, { staleTime: 0 })
      );
      const alreadyExists = imported.find(item => existingCodes.has(item.code));
      if (alreadyExists)
        throw new Error(
          "业务代号已存在：" + alreadyExists.code + "。请先修正 CSV 再导入。"
        );
      const domainByCode = new Map(
        (imported.some(item => item.domainCode) ? await utils.project.activeDomains.fetch(undefined, { staleTime: 0 }) : []).map(domain => [
          String(domain.code).toUpperCase(),
          domain.id,
        ])
      );
      const invalidDomain = imported.find(
        item =>
          item.domainCode && !domainByCode.has(item.domainCode.toUpperCase())
      );
      if (invalidDomain)
        throw new Error(
          `工作域代号不存在：${invalidDomain.domainCode}。请留空或使用当前可选工作域。`
        );
      for (const item of imported) {
        await createProject.mutateAsync({
          code: item.code,
          name: item.name,
          description: item.description,
          domainId: item.domainCode
            ? (domainByCode.get(item.domainCode.toUpperCase()) ?? null)
            : null,
        });
        importedCount += 1;
      }
      void utils.project.invalidate();
      toast.success("已导入 " + importedCount + " 个业务项目。");
    } catch (error) {
      if (importedCount > 0) void utils.project.invalidate();
      const message =
        error instanceof Error ? error.message : "业务 CSV 导入失败。";
      toast.error(
        importedCount > 0
          ? "导入已中断：已创建 " + importedCount + " 个业务项目；" + message
          : message
      );
    } finally {
      csvImportInProgressRef.current = false;
      setImporting(false);
      event.target.value = "";
    }
  };
  const downloadSampleCsv = () => {
    const csvTemplate = "业务代号,业务名称,工作域代号,业务说明\r\n";
    const blob = new Blob(["﻿" + csvTemplate], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "业务项目导入模板.csv";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("已下载标准业务导入 CSV 模板。");
  };
  return (
    <>
      <BusinessCenterView
        projects={(projects.data?.items ?? []) as ProjectRecord[]}
        total={projects.data?.total ?? 0}
        page={projects.data?.page ?? page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={value => { setPageSize(value); setPage(1); }}
        queryState={{ loading: projects.isLoading, refreshing: projects.isFetching,
          error: projects.isError, hasData: projects.data !== undefined,
          retry: () => void projects.refetch() }}
        filterError={filterError}
        status={status}
        onStatusChange={value => { setPage(1); onStatusChange(value); }}
        onLifecycle={setArchiveTarget}
        canCreate={canCreate}
        filterForm={filterForm}
        setFilterForm={setFilterForm}
        onQuery={() => {
          if (filterForm.startDate && filterForm.endDate && filterForm.startDate > filterForm.endDate) {
            setFilterError("创建时间范围无效，结束日期不能早于开始日期。");
            return;
          }
          setFilterError(""); setPage(1); setAppliedFilters({ ...filterForm, keyword: filterForm.keyword.trim() });
        }}
        onReset={() => {
          const empty = { keyword: "", startDate: "", endDate: "" };
          setFilterForm(empty);
          setAppliedFilters(empty);
          setFilterError(""); setPage(1);
        }}
        showCreate={showCreate}
        setShowCreate={setShowCreate}
        form={form}
        setForm={setForm}
        domains={domains.data ?? []}
        domainDirectory={{
          loading: domains.isLoading,
          error: domains.isError,
          retry: () => void domains.refetch(),
        }}
        unitDirectory={{
          query: unitDirectoryQuery,
          setQuery: setUnitDirectoryQuery,
          options: activeUnits.data?.items ?? [],
          hasMore: activeUnits.data?.hasMore ?? false,
          loading:
            unitDirectoryQuery.trim() !== debouncedUnitDirectoryQuery ||
            activeUnits.isFetching,
          error:
            unitDirectoryQuery.trim() === debouncedUnitDirectoryQuery &&
            activeUnits.isError,
          retry: () => void activeUnits.refetch(),
        }}
        userDirectory={{
          query: userDirectoryQuery,
          setQuery: setUserDirectoryQuery,
          options: activeUsers.data?.items ?? [],
          hasMore: activeUsers.data?.hasMore ?? false,
          loading:
            userDirectoryQuery.trim() !== debouncedUserDirectoryQuery ||
            activeUsers.isFetching,
          error:
            userDirectoryQuery.trim() === debouncedUserDirectoryQuery &&
            activeUsers.isError,
          retry: () => void activeUsers.refetch(),
        }}
        creating={createProject.isPending}
        importing={importing}
        onRequestImport={() => importRef.current?.click()}
        onDownloadTemplate={downloadSampleCsv}
        onCreate={() =>
          createProject.mutate({
            ...form,
            domainId: form.domainId || null,
            visibleUserIds: form.visibleUserIds,
            visibleUnitIds: form.visibleUnitIds,
          })
        }
        onOpenProject={onOpenProject}
      />
      <input
        ref={importRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={event => void importBusinesses(event)}
      />
      {archiveTarget && <Suspense fallback={<p role="status" className="aiflow-type-body p-4">正在加载业务归档管理…</p>}>
        <ProjectArchiveDialog key={archiveTarget.id} project={archiveTarget} onClose={() => setArchiveTarget(null)} />
      </Suspense>}
    </>
  );
}

type DirectorySearchState = {
  query: string;
  setQuery: (query: string) => void;
  options: any[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  retry: () => void;
};

type DirectoryStatus = {
  loading: boolean;
  error: boolean;
  retry: () => void;
};

type BusinessCenterViewProps = {
  projects: ProjectRecord[];
  status: "active" | "archived";
  onStatusChange: (status: "active" | "archived") => void;
  onLifecycle: (project: ProjectRecord) => void;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  queryState: { loading: boolean; refreshing: boolean; error: boolean; hasData: boolean; retry: () => void };
  filterError: string;
  canCreate: boolean;
  filterForm: { keyword: string; startDate: string; endDate: string };
  setFilterForm: (value: {
    keyword: string;
    startDate: string;
    endDate: string;
  }) => void;
  onQuery: () => void;
  onReset: () => void;
  showCreate: boolean;
  setShowCreate: (value: boolean | ((previous: boolean) => boolean)) => void;
  form: any;
  setForm: (value: any) => void;
  domains: any[];
  domainDirectory: DirectoryStatus;
  unitDirectory: DirectorySearchState;
  userDirectory: DirectorySearchState;
  creating: boolean;
  importing: boolean;
  onRequestImport: () => void;
  onDownloadTemplate: () => void;
  onCreate: () => void;
  onOpenProject: (project: ProjectRecord) => void;
};

function ProjectMoreDetails({ project }: { project: ProjectRecord }) {
  return (
    <dl className="aiflow-type-body grid gap-x-4 gap-y-2 sm:grid-cols-2">
      <div>
        <dt className="aiflow-type-meta text-muted-foreground">根部门</dt>
        <dd className="aiflow-type-body mt-0.5 break-words text-foreground">
          {project.rootDepartment || "未配置"}
        </dd>
      </div>
      <div>
        <dt className="aiflow-type-meta text-muted-foreground">创建人</dt>
        <dd className="aiflow-type-body mt-0.5 break-words text-foreground">
          {project.ownerName || project.ownerUsername || "—"}
        </dd>
      </div>
      <div>
        <dt className="aiflow-type-meta text-muted-foreground">创建时间</dt>
        <dd className="aiflow-type-code mt-0.5 font-mono tabular-nums text-foreground">
          {formatDate(project.createdAt)}
        </dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="aiflow-type-meta text-muted-foreground">说明</dt>
        <dd className="aiflow-type-body mt-0.5 whitespace-pre-wrap break-words text-foreground">
          {project.description || "—"}
        </dd>
      </div>
    </dl>
  );
}

function DirectoryRetry({
  name,
  onRetry,
}: {
  name: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="aiflow-type-body flex flex-col gap-2 rounded-md border border-aiflow-warning-border bg-aiflow-warning-surface px-3 py-2 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>{name}目录暂时无法加载；已选对象会保留，重试后可继续调整。</span>
      <Button
        type="button"
        variant="outline"
        className="h-11 min-[1280px]:h-8"
        onClick={onRetry}
      >
        重试
      </Button>
    </div>
  );
}

function BusinessCenterView({
  projects,
  status, onStatusChange, onLifecycle,
  total, page, pageSize, onPageChange, onPageSizeChange, queryState, filterError,
  canCreate,
  filterForm,
  setFilterForm,
  onQuery,
  onReset,
  showCreate,
  setShowCreate,
  form,
  setForm,
  domains,
  domainDirectory,
  unitDirectory,
  userDirectory,
  creating,
  importing,
  onRequestImport,
  onDownloadTemplate,
  onCreate,
  onOpenProject,
}: BusinessCenterViewProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [domainSelectorQuery, setDomainSelectorQuery] = useState("");
  useEffect(() => {
    if (!showCreate) setDomainSelectorQuery("");
  }, [showCreate]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageProjects = projects;

  const pagination =
    (
      <div className="aiflow-type-meta flex flex-col gap-2 border-t border-border/80 bg-card px-4 py-3 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span aria-live="polite">
          显示第 {total ? (currentPage - 1) * pageSize + 1 : 0}–
          {Math.min(currentPage * pageSize, total)} 项，共 {total} 个业务项目
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span>每页</span>
            <select
              className="aiflow-type-control h-11 rounded-md border border-border bg-card px-2 min-[1280px]:h-8"
              value={pageSize}
              disabled={queryState.refreshing}
              onChange={event => {
                onPageSizeChange(Number(event.target.value));
              }}
              aria-label="每页显示数量"
            >
              <option value={10}>10 条</option>
              <option value={25}>25 条</option>
              <option value={50}>50 条</option>
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="aiflow-type-control h-11 min-[1280px]:h-8"
            disabled={queryState.refreshing || currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          >
            上一页
          </Button>
          <span
            className="aiflow-type-code min-w-12 text-center font-mono tabular-nums"
            aria-current="page"
          >
            {currentPage} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="aiflow-type-control h-11 min-[1280px]:h-8"
            disabled={queryState.refreshing || currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          >
            下一页
          </Button>
        </div>
      </div>
    );

  return (
    <div
      data-aiflow-business-center=""
      className="min-h-[calc(100dvh-48px)] min-w-0 bg-background p-3 sm:p-5"
    >
      <div className="mx-auto w-full max-w-[1600px] min-w-0">
        <header className="mb-4 flex flex-col gap-3 border-b border-border/80 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="aiflow-type-meta mb-0.5 text-muted-foreground">
              流程设计 / 业务项目
            </p>
            <h1 className="aiflow-type-page-title font-semibold tracking-tight text-foreground">
              业务中心
            </h1>
            <p className="aiflow-type-body mt-1 text-muted-foreground">
              管理业务项目，并进入对应流程与资源工作区。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <details className="relative">
              <summary className="aiflow-type-control inline-flex h-11 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-card px-2.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 min-[1280px]:h-8">
                导入 / 模板
                <span aria-hidden="true">▾</span>
              </summary>
              <div
                role="group"
                aria-label="业务项目导入与模板操作"
                className="absolute left-0 right-auto z-30 mt-1 grid min-w-44 max-w-[calc(100vw-24px)] gap-1 rounded-lg border border-border bg-card p-1.5 shadow-lg sm:left-auto sm:right-0"
              >
                <button
                  type="button"
                  disabled={!canCreate}
                  aria-label="下载业务导入模板 CSV"
                  onClick={onDownloadTemplate}
                  className="aiflow-type-control min-h-11 rounded px-2.5 py-2 text-left text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 min-[1280px]:min-h-0"
                >
                  下载导入模板
                </button>
                <button
                  type="button"
                  disabled={!canCreate || importing || status === "archived"}
                  aria-label={importing ? "正在导入业务 CSV" : "导入业务 CSV"}
                  onClick={onRequestImport}
                  className="aiflow-type-control min-h-11 rounded px-2.5 py-2 text-left text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 min-[1280px]:min-h-0"
                >
                  {importing ? "正在导入…" : "导入业务 CSV"}
                </button>
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  disabled
                  aria-label="同步 BDP 配置，未配置连接，暂不可用"
                  title="当前未配置受管 BDP 连接，无法同步外部业务配置。"
                  className="aiflow-type-control min-h-11 rounded px-2.5 py-2 text-left text-muted-foreground disabled:cursor-not-allowed min-[1280px]:min-h-0"
                >
                  同步 BDP 配置 · 未配置连接
                </button>
              </div>
            </details>
            {canCreate && status === "active" && (
              <Button
                type="button"
                size="sm"
                className="aiflow-type-control h-11 bg-slate-900 px-3 font-medium text-white hover:bg-slate-800 min-[1280px]:h-8"
                onClick={() => setShowCreate(true)}
              >
                <Plus size={14} className="mr-1" />
                新增业务
              </Button>
            )}
          </div>
        </header>

        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-2xs">
          <div className="border-b border-border bg-muted/70 p-3 sm:p-4">
            <div className="aiflow-type-section-title mb-2 flex items-center gap-2 font-semibold text-foreground">
              <FolderKanban size={15} className="text-muted-foreground" />
              业务列表
              <span className="aiflow-type-meta font-normal text-muted-foreground">
                （{total}）
              </span>
            </div>
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="业务归档范围">
              {([['active', '在用业务'], ['archived', '已归档']] as const).map(([value, label]) =>
                <Button key={value} type="button" variant={status === value ? "secondary" : "outline"} aria-pressed={status === value} onClick={() => onStatusChange(value)}>{label}</Button>)}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="搜索业务名称、代号或工作域"
                className="aiflow-type-control h-11 min-w-0 flex-1 bg-card min-[1280px]:h-9"
                placeholder="搜索业务名称、代号或工作域"
                value={filterForm.keyword}
                onChange={event =>
                  setFilterForm({ ...filterForm, keyword: event.target.value })
                }
                onKeyDown={event => {
                  if (event.key === "Enter") onQuery();
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="aiflow-type-control h-11 min-[1280px]:h-9"
                  onClick={onQuery}
                >
                  查询
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="aiflow-type-control h-11 min-[1280px]:h-9"
                  onClick={onReset}
                >
                  重置
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="aiflow-type-control h-11 min-[1280px]:h-9"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen(value => !value)}
                >
                  {advancedOpen ? "收起筛选" : "日期筛选"}
                </Button>
              </div>
            </div>
            {advancedOpen && (
              <div className="mt-3 grid gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-2">
                <label className="aiflow-type-control grid gap-1 text-muted-foreground">
                  创建时间从
                  <Input
                    className="h-11 min-[1280px]:h-9"
                    type="date"
                    aria-label="创建时间开始"
                    value={filterForm.startDate}
                    onChange={event =>
                      setFilterForm({
                        ...filterForm,
                        startDate: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="aiflow-type-control grid gap-1 text-muted-foreground">
                  创建时间至
                  <Input
                    className="h-11 min-[1280px]:h-9"
                    type="date"
                    aria-label="创建时间结束"
                    value={filterForm.endDate}
                    onChange={event =>
                      setFilterForm({
                        ...filterForm,
                        endDate: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
            )}
            <p className="aiflow-type-body mt-2 text-muted-foreground">
              仅展示当前账号有权查看的业务项目；筛选不会扩大访问范围。
            </p>
            {filterError && <p role="alert" className="mt-2 text-sm text-aiflow-danger">{filterError}</p>}
          </div>

          {queryState.loading ? (
            <div data-business-list-loading="" role="status" className="aiflow-type-body flex items-center gap-2 p-6 text-muted-foreground">
              <Loader2 className="animate-spin" size={16} />正在读取当前账号可见的业务项目…
            </div>
          ) : queryState.error ? (
            <div data-business-list-error={!queryState.hasData ? "" : undefined}
              data-business-list-stale={queryState.hasData ? "" : undefined}
              role="alert" className="aiflow-type-body flex flex-wrap items-center justify-between gap-2 p-4 text-aiflow-danger">
              <span>{queryState.hasData ? "刷新失败，当前显示上次成功读取的业务列表。" : "业务列表暂时无法加载；这不代表当前没有可访问的业务项目。"}</span>
              <Button variant="outline" onClick={queryState.retry}>重试</Button>
            </div>
          ) : queryState.refreshing && <p role="status" className="aiflow-type-body px-4 py-2 text-muted-foreground">正在刷新业务列表…</p>}

          <div className="hidden min-[900px]:block">
            <div className="overflow-x-auto">
              <table className="aiflow-type-body w-full min-w-[720px] table-fixed text-left">
                <thead className="aiflow-type-control bg-muted font-medium text-muted-foreground">
                  <tr>
                    <th className="aiflow-type-control w-[36%] px-4 py-3">
                      业务名称 / 代号
                    </th>
                    <th className="aiflow-type-control w-[8%] px-4 py-3 text-right">
                      流程数
                    </th>
                    <th className="aiflow-type-control w-[20%] px-4 py-3">
                      工作域
                    </th>
                    <th className="aiflow-type-control w-[20%] px-4 py-3">
                      创建时间
                    </th>
                    <th className="aiflow-type-control w-[16%] px-4 py-3 text-right">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageProjects.map(project => (
                    <tr
                      key={project.id} data-project-row="" data-project-id={project.id}
                      className="border-t border-border hover:bg-muted/70"
                    >
                      <td className="min-w-0 px-4 py-3">
                        <p
                          className="aiflow-type-body truncate font-medium text-foreground"
                          title={project.name}
                        >
                          {project.name}
                        </p>
                        <p className="aiflow-type-meta mt-0.5 truncate font-mono text-muted-foreground">
                          {project.code}
                        </p>
                      </td>
                      <td className="aiflow-type-body px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {status === "archived" ? (project.archivedWorkflowCount ?? 0) : project.workflowCount == null
                          ? "—"
                          : project.workflowCount}
                      </td>
                      <td className="aiflow-type-body px-4 py-3 text-muted-foreground">
                        {project.domainCode ? (
                          <span
                            className="block truncate"
                            title={project.domainName || project.domainCode}
                          >
                            {project.domainCode} ·{" "}
                            {project.domainName || project.domainCode}
                          </span>
                        ) : (
                          "未归属"
                        )}
                      </td>
                      <td className="aiflow-type-meta px-4 py-3 font-mono tabular-nums text-muted-foreground">
                        {project.createdAt
                          ? new Date(project.createdAt).toLocaleDateString(
                              "zh-CN"
                            )
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button
                          type="button"
                          size="sm"
                          className="aiflow-type-control h-8 px-2.5"
                          onClick={() => status === "archived" ? onLifecycle(project) : onOpenProject(project)}
                        >
                          {status === "archived" ? "查看归档" : "进入"}
                        </Button>
                        <Popover>
                          <PopoverTrigger asChild><Button variant="outline" size="sm" className="ml-1" aria-label={`更多业务操作：${project.name}`}>更多</Button></PopoverTrigger>
                          <PopoverContent align="end" className="w-[min(360px,calc(100vw-24px))] p-3 text-left">
                            <ProjectMoreDetails project={project} />
                            {status === "active" && Boolean(project.canManageArchive) && <Button type="button" variant="outline" className="mt-3 w-full" aria-label={`归档业务：${project.name}`} onClick={() => onLifecycle(project)}>归档业务</Button>}
                          </PopoverContent>
                        </Popover>
                      </td>
                    </tr>
                  ))}
                  {!queryState.loading && !queryState.error && !pageProjects.length && (
                    <tr>
                      <td
                        colSpan={5}
                        className="aiflow-type-body px-4 py-12 text-center text-muted-foreground"
                      >
                        没有符合条件的业务项目。请调整筛选条件，或重置筛选。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="grid gap-2 p-3 sm:grid-cols-2 sm:gap-3 min-[900px]:hidden">
            {pageProjects.map(project => (
              <li
                key={project.id} data-project-row="" data-project-id={project.id}
                className="min-w-0 rounded-md border border-border p-3 sm:p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="aiflow-type-card-title break-words font-semibold text-foreground">
                      {project.name}
                    </h2>
                    <p className="aiflow-type-meta mt-1 truncate font-mono text-muted-foreground">
                      {project.code}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="aiflow-type-control h-11 shrink-0 px-2.5 min-[1280px]:h-8"
                    onClick={() => status === "archived" ? onLifecycle(project) : onOpenProject(project)}
                  >
                    {status === "archived" ? "查看归档" : "进入"}
                  </Button>
                  {status === "active" && Boolean(project.canManageArchive) && <Button type="button" variant="outline" size="sm" className="aiflow-type-control h-11 shrink-0 px-2.5" aria-label={`归档业务：${project.name}`} onClick={() => onLifecycle(project)}>归档</Button>}
                </div>
                <dl className="aiflow-type-body mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  <div>
                    <dt className="aiflow-type-meta text-muted-foreground">
                      流程数
                    </dt>
                    <dd className="aiflow-type-body mt-0.5 font-mono tabular-nums text-foreground">
                      {status === "archived" ? (project.archivedWorkflowCount ?? 0) : project.workflowCount == null
                        ? "—"
                        : project.workflowCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="aiflow-type-meta text-muted-foreground">
                      工作域
                    </dt>
                    <dd className="aiflow-type-body mt-0.5 break-words text-foreground">
                      {project.domainCode
                        ? project.domainName || project.domainCode
                        : "未归属"}
                    </dd>
                  </div>
                </dl>
                <details className="group mt-3 border-t border-border pt-2">
                  <summary className="aiflow-type-control flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
                    更多项目资料
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="mt-3">
                    <ProjectMoreDetails project={project} />
                  </div>
                </details>
              </li>
            ))}
            {!queryState.loading && !queryState.error && !pageProjects.length && (
              <li className="aiflow-type-body p-8 text-center text-muted-foreground">
                没有符合条件的业务项目。请调整筛选条件，或重置筛选。
              </li>
            )}
          </ul>

          {pagination}
        </section>
        <CreationDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          title="新增业务"
          description="创建业务后，你将拥有该业务；可同时配置可见人与可见部门。"
          submitLabel="保存业务"
          pending={creating}
          submitDisabled={domainDirectory.loading || domainDirectory.error}
          onSubmit={onCreate}
        >
          <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
            业务代号
            <Input
              aria-label="业务代号"
              className="h-11 min-[1280px]:h-9"
              placeholder="如 OPS"
              value={form.code}
              onChange={event =>
                setForm({ ...form, code: event.target.value.toUpperCase() })
              }
              required
            />
          </label>
          <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
            业务名称
            <Input
              aria-label="业务名称"
              className="h-11 min-[1280px]:h-9"
              value={form.name}
              onChange={event => setForm({ ...form, name: event.target.value })}
              required
            />
          </label>
          <div className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
            <span>工作域</span>
            <SearchableMultiSelect
              ariaLabel="选择工作域"
              value={form.domainId ? [form.domainId] : []}
              options={domains.map(domain => ({
                value: String(domain.id),
                label: `${domain.code} · ${domain.name}`,
                keywords: `${domain.code} ${domain.name}`,
              }))}
              query={domainSelectorQuery}
              onQueryChange={setDomainSelectorQuery}
              onChange={values =>
                setForm({ ...form, domainId: values[0] ?? "" })
              }
              placeholder="未归属工作域"
              searchPlaceholder="搜索工作域名称或代号"
              startSearchMessage="输入工作域名称或代号；不选择将保持未归属。"
              emptyMessage="当前没有启用的工作域。"
              noResultsMessage="没有匹配的工作域，请更换搜索词。"
              loading={domainDirectory.loading}
              error={domainDirectory.error}
              maxSelected={1}
              requireSearch={domains.length > 50}
            />
            {domainDirectory.loading && (
              <p
                role="status"
                className="aiflow-type-body font-normal text-muted-foreground"
              >
                正在加载工作域…
              </p>
            )}
            {domainDirectory.error && (
              <>
                <DirectoryRetry name="工作域" onRetry={domainDirectory.retry} />
                <p
                  role="status"
                  className="aiflow-type-body font-normal text-aiflow-warning"
                >
                  为避免业务意外保存为未归属状态，工作域目录恢复前暂不能保存。
                </p>
              </>
            )}
            {!domainDirectory.loading &&
              !domainDirectory.error &&
              domains.length === 0 && (
                <p
                  role="status"
                  className="aiflow-type-body font-normal text-muted-foreground"
                >
                  当前没有可选工作域；新业务将保持未归属状态。
                </p>
              )}
          </div>
          <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
            业务说明（可选）
            <Input
              aria-label="业务说明（可选）"
              className="h-11 min-[1280px]:h-9"
              value={form.description}
              onChange={event =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
          <div className="grid gap-1">
            <label className="aiflow-type-control font-medium text-muted-foreground">
              添加可见部门（可多选；部门成员自动继承可见权）
            </label>
            <SearchableMultiSelect
              ariaLabel="添加可见部门"
              value={form.visibleUnitIds}
              options={unitDirectory.options.map(unit => ({
                value: String(unit.id),
                label: unit.displayPath || `${unit.name}（${unit.code}）`,
                keywords: `${unit.name} ${unit.code} ${unit.pathName ?? ""} ${unit.pathCode ?? ""}`,
              }))}
              query={unitDirectory.query}
              onQueryChange={unitDirectory.setQuery}
              onChange={values => setForm({ ...form, visibleUnitIds: values })}
              placeholder="未指定部门"
              searchPlaceholder="搜索部门名称、路径或代号"
              startSearchMessage="输入部门名称、路径或代号后搜索。"
              emptyMessage="没有可用部门，请检查组织架构配置。"
              noResultsMessage="没有匹配的启用部门，请更换搜索词。"
              loading={unitDirectory.loading}
              error={unitDirectory.error}
              hasMore={unitDirectory.hasMore}
              requireSearch
            />
            {unitDirectory.error && (
              <DirectoryRetry name="部门" onRetry={unitDirectory.retry} />
            )}
          </div>
          <div className="grid gap-1">
            <label className="aiflow-type-control font-medium text-muted-foreground">
              添加可见人（可多选；直接授权人员可见权）
            </label>
            <SearchableMultiSelect
              ariaLabel="添加可见人"
              value={form.visibleUserIds.map(String)}
              options={userDirectory.options.map(user => ({
                value: String(user.id),
                label: user.name
                  ? `${user.name}（${user.username}）`
                  : user.username,
                keywords: user.username,
              }))}
              query={userDirectory.query}
              onQueryChange={userDirectory.setQuery}
              onChange={values =>
                setForm({
                  ...form,
                  visibleUserIds: values
                    .map(Number)
                    .filter(
                      userId => Number.isSafeInteger(userId) && userId > 0
                    ),
                })
              }
              placeholder="未指定人员"
              searchPlaceholder="搜索姓名或账号"
              startSearchMessage="输入姓名或账号后搜索；支持同时选择多人。"
              emptyMessage="未找到可授权的有效账号。"
              noResultsMessage="没有匹配的有效账号，请更换搜索词。"
              loading={userDirectory.loading}
              error={userDirectory.error}
              hasMore={userDirectory.hasMore}
              requireSearch
            />
            {userDirectory.error && (
              <DirectoryRetry name="人员" onRetry={userDirectory.retry} />
            )}
          </div>
          <div className="aiflow-type-body rounded border border-aiflow-info-border bg-aiflow-info-surface/60 p-2.5 text-muted-foreground">
            <strong>权限隔离保护：</strong>
            创建人默认拥有该业务所有权（Owner）；所选可见人与可见部门成员拥有查看与协作权；超级管理员（Super
            Admin）拥有全局全量业务查看权。
          </div>
        </CreationDialog>
      </div>
    </div>
  );
}

type WorkspaceView = "process" | "members" | "resources" | "services";
type ProcessFilters = {
  flowType?: "state" | "control" | "data";
  auditStatus?: "init" | "approved" | "rejected";
  status?: "draft" | "published";
  keyword?: string;
};

export function ProjectWorkspace({
  project,
  onBack,
  onOpenWorkflow,
  onOpenDetail,
  onOpenWarehouse,
}: {
  project: ProjectRecord;
  onBack: () => void;
  onOpenWorkflow: (workflowId: string) => void;
  onOpenDetail: (workflowId: string) => void;
  onOpenWarehouse: () => void;
}) {
  const utils = trpc.useUtils();
  const [view, setView] = useResourceDraftState<WorkspaceView>(project.id, "workspace", "view", "process", false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filters, setFilters] = useState<ProcessFilters>({});
  const [filterForm, setFilterForm] = useState<ProcessFilters>({});
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    processCode: "",
    name: "",
    description: "",
    flowType: "state" as "state" | "control" | "data",
    creationSource: "manual" as "manual" | "warehouse",
    dataSourceId: "",
  });
  useEffect(() => {
    setFilters({});
    setFilterForm({});
    setShowCreate(false);
  }, [project.id]);
  const access = trpc.project.access.useQuery(
    { projectId: project.id },
    authorizationQueryPolicy(true)
  );
  const workflows = trpc.project.workflows.useQuery({
    projectId: project.id,
    ...filters,
  }, authorizationQueryPolicy(view === "process"));
  const members = trpc.project.members.useQuery(
    { projectId: project.id },
    { retry: false, refetchInterval: view === "members" ? 30_000 : false, refetchIntervalInBackground: false }
  );
  const refreshAccess = () => Promise.all([access.refetch(), members.refetch(), workflows.refetch()]);
  const serviceEndpoints = trpc.project.serviceEndpoints.useQuery(
    { projectId: project.id },
    { enabled: view === "services" }
  );
  const createResources = trpc.data.resources.useQuery(
    { projectId: project.id },
    {
      enabled:
        showCreate &&
        form.flowType === "data" &&
        form.creationSource === "manual",
    }
  );
  const capabilities = projectCapabilities(
    access.data?.permissions,
    !access.isPending && !access.isError
  );
  const { canManage, canCreate } = capabilities;
  const createWorkflow = trpc.project.createWorkflow.useMutation({
    onSuccess: (workflow: any) => {
      void utils.project.workflows.invalidate({ projectId: project.id });
      void utils.project.invalidate();
      setShowCreate(false);
      setForm({
        processCode: "",
        name: "",
        description: "",
        flowType: "state",
        creationSource: "manual",
        dataSourceId: "",
      });
      toast.success("项目流程已创建，待审核后可发布。");
      if (workflow?.id) onOpenWorkflow(workflow.id);
    },
    onError: error => toast.error(error.message),
  });
  const runWorkflow = trpc.workflow.run.useMutation({
    onSuccess: result =>
      toast.success(`流程已发起：${result.runId.slice(0, 8)}`),
    onError: error => toast.error(error.message),
  });
  const runDataflow = trpc.data.run.useMutation({
    onSuccess: result => {
      void utils.data.runs.invalidate({ projectId: project.id });
      toast.success(
        `${result.status === "success" ? "数据流运行完成" : "数据流已进入持久化执行队列"}：${result.runId.slice(0, 8)}`
      );
    },
    onError: error => toast.error(error.message),
  });
  const menu = [
    { id: "process" as const, label: "流程设计中心", icon: LayoutList },
    { id: "members" as const, label: "权限配置中心", icon: ShieldCheck },
    { id: "resources" as const, label: "资源配置中心", icon: Database },
    { id: "services" as const, label: "服务端点", icon: Globe2 },
  ];
  if (view === "process" && workflows.isLoading)
    return (
      <div
        data-project-workspace-loading
        role="status"
        aria-live="polite"
        className="grid min-h-[calc(100vh-48px)] place-items-center bg-card p-6 text-center"
      >
        <div className="border border-border bg-card px-5 py-4 shadow-2xs">
          <Loader2 className="mx-auto animate-spin text-foreground" size={20} />
          <p className="mt-2 text-sm font-medium text-foreground">
            正在读取项目流程
          </p>
          <p className="aiflow-type-body mt-1 text-muted-foreground">
            正在加载当前业务授权范围内的流程与审核状态…
          </p>
        </div>
      </div>
    );
  if (access.isError || (access.isSuccess && !capabilities.ready))
    return (
      <section role="alert" data-project-access-denied="" className="m-4 grid gap-3 rounded-lg border border-border bg-card p-5">
        <h1 className="aiflow-type-page-title font-semibold">{access.isError ? "暂时无法确认业务权限" : "业务访问权限已变化"}</h1>
        <p className="aiflow-type-body text-muted-foreground">{access.isError ? "业务权限读取失败，缓存内容暂时隐藏。当前填写仍保留在本次账号会话中，可重新读取后继续。" : "当前无权查看此业务，或业务状态已变化。请刷新权限或返回业务中心。"}</p>
        <ResourceDraftRecoveryNotice />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={access.isFetching || members.isFetching} onClick={() => void refreshAccess()}>刷新业务权限</Button>
          <Button type="button" variant="outline" onClick={onBack}>返回业务中心</Button>
        </div>
      </section>
    );
  return (
    <div
      data-aiflow-project-workspace=""
      className="flex min-h-[calc(100vh-48px)] flex-col bg-background lg:flex-row"
    >
      <aside
        className={`w-full shrink-0 border-b border-border bg-card transition-[width] duration-200 lg:border-b-0 lg:border-r ${sidebarCollapsed ? "lg:w-14" : "lg:w-56"}`}
      >
        <div
          className={`border-b border-border p-3.5 ${sidebarCollapsed ? "lg:px-1.5" : ""}`}
        >
          <div
            className={`flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"}`}
          >
            <button
              type="button"
              className={`aiflow-type-control inline-flex min-h-11 items-center gap-1 rounded px-2 text-muted-foreground hover:bg-muted hover:text-foreground ${sidebarCollapsed ? "lg:hidden" : ""}`}
              onClick={onBack}
            >
              <ChevronLeft size={13} />
              返回业务中心
            </button>
            <button
              type="button"
              aria-label={
                sidebarCollapsed ? "展开项目工作区导航" : "收起项目工作区导航"
              }
              title={sidebarCollapsed ? "展开导航" : "收起导航"}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setSidebarCollapsed(value => !value)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={15} />
              ) : (
                <PanelLeftClose size={15} />
              )}
            </button>
          </div>
          {!sidebarCollapsed && (
            <>
              <h2
                aria-label={project.name}
                className="aiflow-type-section-title mt-2.5 hidden break-words font-semibold text-foreground [overflow-wrap:anywhere] lg:block"
              >
                {project.name.replaceAll("_", "_\u200b")}
              </h2>
              <p className="aiflow-type-meta hidden font-mono text-muted-foreground lg:block">
                {project.code}
              </p>
            </>
          )}
          <p className="aiflow-type-meta mt-2 hidden text-center font-mono text-muted-foreground lg:block">
            {sidebarCollapsed ? project.code.slice(0, 4) : ""}
          </p>
        </div>
        <nav
          aria-label="项目工作区"
          className="grid min-w-0 grid-cols-2 gap-1.5 border-b border-border p-1.5 sm:flex sm:flex-wrap lg:grid lg:grid-cols-1 lg:gap-0.5 lg:overflow-visible lg:border-b-0"
        >
          {menu.map(item => (
            <button
              key={item.id}
              type="button"
              aria-current={view === item.id ? "page" : undefined}
              title={sidebarCollapsed ? item.label : undefined}
              onClick={() => {
                if (item.id === view) return;
                const proceed = () => {
                  setView(item.id);
                  if (item.id === "members") void members.refetch();
                };
                if (requestConsoleNavigation(proceed)) proceed();
              }}
              className={`aiflow-type-control flex min-h-11 min-w-0 items-center rounded-md px-2.5 text-left transition-colors ${sidebarCollapsed ? "justify-center" : "gap-2"} ${view === item.id ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              <item.icon size={15} />
              {!sidebarCollapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                    {item.label}
                  </span>
                  {item.id === "members" && (
                    <span className="aiflow-type-meta shrink-0 rounded bg-card/70 px-1.5 text-muted-foreground tabular-nums">
                      {new Set((members.data ?? []).map(member => member.userId)).size}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </nav>
      </aside>
      <section className="min-w-0 flex-1 p-4 sm:p-5">
        <AuthorizationDetailRefresh
          query={{ ...access, isFetching: access.isFetching || members.isFetching, refetch: refreshAccess }}
          label="刷新业务权限"
          buttonLabel="刷新业务权限"
          disabled={false}
          embedded
        />
        <PermissionListFeedback
          name="业务权限"
          loading={access.isPending}
          error={access.isError}
          onRetry={() => void refreshAccess()}
        />
        {view === "process" && (
          <ProcessCenter
            project={project}
            workflows={(workflows.data ?? []) as any[]}
            filters={filterForm}
            setFilters={setFilterForm}
            onApplyFilters={() => setFilters(filterForm)}
            onResetFilters={() => {
              setFilterForm({});
              setFilters({});
            }}
            onRefreshWorkflows={() => {
              void workflows.refetch();
              void utils.project.invalidate();
            }}
            refreshingWorkflows={workflows.isFetching}
            workflowLoadFailed={workflows.isError}
            actionsReady={!workflows.isPending && !workflows.isError && capabilities.ready}
            showCreate={showCreate}
            setShowCreate={setShowCreate}
            form={form}
            setForm={setForm}
            dataSources={(createResources.data?.sources ?? []) as any[]}
            canCreate={canCreate}
            canManage={canManage}
            creating={createWorkflow.isPending}
            onCreate={() => {
              if (form.creationSource === "warehouse") {
                setShowCreate(false);
                toast.message("请在流程仓库上传并导入流程定义。");
                onOpenWarehouse();
                return;
              }
              createWorkflow.mutate({
                projectId: project.id,
                processCode: form.processCode,
                name: form.name,
                description: form.description || undefined,
                flowType: form.flowType,
                creationSource: "manual",
                dataSourceId:
                  form.flowType === "data" && form.dataSourceId
                    ? form.dataSourceId
                    : null,
              });
            }}
            onOpenWorkflow={onOpenWorkflow}
            onOpenWarehouse={onOpenWarehouse}
            onLaunch={workflow =>
              workflow.flowType === "data"
                ? runDataflow.mutate({
                    projectId: project.id,
                    workflowId: workflow.id,
                  })
                : runWorkflow.mutate({ workflowId: workflow.id, input: {} })
            }
            onDetail={onOpenDetail}
          />
        )}
        {view === "members" && (
          <ProjectMembers
            projectId={project.id}
            members={(members.data ?? []) as any[]}
            membersLoading={members.isPending}
            membersError={members.isError}
            onRetryMembers={() => void members.refetch()}
            canManage={canManage}
            viewAllowed={capabilities.ready}
            onRefreshAccess={() => Promise.all([access.refetch(), members.refetch()])}
          />
        )}
        {view === "resources" && (
          <ResourceEditContext.Provider value={{ ...capabilities, refreshing: access.isFetching || members.isFetching, refresh: () => void refreshAccess() }}>
            <Suspense fallback={<p role="status" className="aiflow-type-body py-4 text-muted-foreground">正在加载资源配置中心…</p>}>
              <DataResourceCenter projectId={project.id} onOpenWorkflow={onOpenWorkflow} />
            </Suspense>
          </ResourceEditContext.Provider>
        )}
        {view === "services" && (
          <ServiceEndpointCenter
            projectId={project.id}
            endpoints={(serviceEndpoints.data ?? []) as any[]}
            loading={serviceEndpoints.isLoading}
            canManage={canManage}
          />
        )}
      </section>
    </div>
  );
}

type ServiceEndpointTargetEnvironment =
  | "development"
  | "test"
  | "staging"
  | "production";

const SERVICE_ENDPOINT_ENVIRONMENTS: Array<{
  value: ServiceEndpointTargetEnvironment;
  label: string;
}> = [
  { value: "development", label: "开发" },
  { value: "test", label: "测试" },
  { value: "staging", label: "预发布" },
  { value: "production", label: "生产" },
];

function ServiceEndpointCenter({
  projectId,
  endpoints,
  loading,
  canManage,
}: {
  projectId: string;
  endpoints: any[];
  loading: boolean;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [statusConfirmation, setStatusConfirmation] = useState<{
    id: string;
    name: string;
    refCode: string;
    status: "active" | "disabled";
  } | null>(null);
  const [form, setForm] = useState({
    refCode: "",
    name: "",
    baseUrl: "",
    targetEnvironment: "" as ServiceEndpointTargetEnvironment | "",
    secretRef: "",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  });
  const refresh = () =>
    void utils.project.serviceEndpoints.invalidate({ projectId });
  const create = trpc.project.createServiceEndpoint.useMutation({
    onSuccess: () => {
      refresh();
      setShowCreate(false);
      setForm({
        refCode: "",
        name: "",
        baseUrl: "",
        targetEnvironment: "",
        secretRef: "",
        authHeaderName: "Authorization",
        authScheme: "Bearer",
      });
      toast.success("项目服务端点已创建。");
    },
    onError: error => toast.error(error.message),
  });
  const setStatus = trpc.project.setServiceEndpointStatus.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("服务端点状态已更新。");
      setStatusConfirmation(null);
    },
    onError: error => toast.error(error.message),
  });
  const setEnvironment = trpc.project.setServiceEndpointEnvironment.useMutation(
    {
      onSuccess: () => {
        refresh();
        toast.success("端点目标环境标记已更新。该标记不提供网络隔离。");
      },
      onError: error => toast.error(error.message),
    }
  );
  const requestStatusChange = (endpoint: any) =>
    setStatusConfirmation({
      id: endpoint.id,
      name: endpoint.name,
      refCode: endpoint.refCode,
      status: endpoint.status === "active" ? "disabled" : "active",
    });
  const targetEnvironmentLabel = (value: string) =>
    SERVICE_ENDPOINT_ENVIRONMENTS.find(option => option.value === value)
      ?.label ?? "未分类";
  const renderTargetEnvironment = (endpoint: any) =>
    canManage ? (
      <select
        aria-label={`设置目标环境：${endpoint.name}（${endpoint.refCode}）`}
        className="aiflow-type-control min-h-11 min-w-28 rounded border border-border bg-card px-2 text-foreground min-[1024px]:min-h-10"
        value={endpoint.targetEnvironment ?? "unclassified"}
        disabled={setEnvironment.isPending}
        onChange={event =>
          setEnvironment.mutate({
            projectId,
            id: endpoint.id,
            targetEnvironment: event.target
              .value as ServiceEndpointTargetEnvironment,
          })
        }
      >
        {endpoint.targetEnvironment === "unclassified" && (
          <option value="unclassified" disabled>
            未分类
          </option>
        )}
        {SERVICE_ENDPOINT_ENVIRONMENTS.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : (
      <span
        className={`aiflow-type-meta inline-flex rounded px-2 py-1 ${endpoint.targetEnvironment === "production" ? "bg-aiflow-danger-surface text-aiflow-danger" : endpoint.targetEnvironment === "unclassified" ? "bg-aiflow-warning-surface text-aiflow-warning" : "bg-aiflow-info-surface text-aiflow-info"}`}
      >
        {targetEnvironmentLabel(endpoint.targetEnvironment ?? "unclassified")}
      </span>
    );
  const submitCreate = () => {
    if (!form.targetEnvironment) {
      toast.error("请选择端点目标环境。");
      return;
    }
    create.mutate({
      projectId,
      ...form,
      targetEnvironment: form.targetEnvironment,
      refCode: form.refCode.toUpperCase(),
      secretRef: form.secretRef || null,
      authHeaderName: form.secretRef ? form.authHeaderName || null : null,
      authScheme: form.secretRef ? form.authScheme || null : null,
    });
  };
  return (
    <div data-project-service-endpoints="">
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="aiflow-type-meta font-bold tracking-[.16em] text-muted-foreground">
            PROJECT SERVICE CATALOG
          </p>
          <h1 className="aiflow-type-page-title mt-1 font-semibold text-foreground">
            服务端点
          </h1>
          <p className="aiflow-type-body mt-1 text-muted-foreground">
            项目流程只能通过这里登记的域名访问外部服务；SecretRef
            只引用运行环境密钥。
          </p>
          <p className="aiflow-type-body mt-2 max-w-3xl rounded-md border border-aiflow-warning-border bg-aiflow-warning-surface px-3 py-2 text-aiflow-warning">
            目标环境是识别标签，不会隔离网络或改变运行目标。调用前仍需确认地址、流程权限和实际副作用。
          </p>
        </div>
        {canManage && (
          <Button
            className="min-h-11 min-[1024px]:min-h-10"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={15} />
            新增端点
          </Button>
        )}
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        {loading && (
          <div
            role="status"
            className="aiflow-type-body p-8 text-center text-muted-foreground"
          >
            正在加载服务端点…
          </div>
        )}
        {!loading && !endpoints.length && (
          <div className="flex min-h-28 items-center justify-center p-5 sm:p-8">
            <p className="aiflow-type-body max-w-md text-center leading-6 text-muted-foreground">
              尚未登记服务端点。项目控制流程中的 HTTP/REST/METHOD
              节点将无法发布。
            </p>
          </div>
        )}
        {!loading && endpoints.length > 0 && (
          <div className="divide-y divide-border lg:hidden">
            {endpoints.map(endpoint => (
              <article key={endpoint.id} className="space-y-3 p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="aiflow-type-meta break-all font-mono font-semibold text-aiflow-info">
                      {endpoint.refCode}
                    </p>
                    <h2 className="aiflow-type-body mt-1 break-words font-medium text-foreground">
                      {endpoint.name}
                    </h2>
                  </div>
                  <span
                    className={`aiflow-type-meta shrink-0 rounded px-2 py-1 ${endpoint.status === "active" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-muted text-muted-foreground"}`}
                  >
                    {endpoint.status === "active" ? "启用" : "停用"}
                  </span>
                </div>
                <dl className="aiflow-type-body space-y-2">
                  <div>
                    <dt className="aiflow-type-meta mb-1 text-muted-foreground">
                      目标环境
                    </dt>
                    <dd>{renderTargetEnvironment(endpoint)}</dd>
                  </div>
                  <div>
                    <dt className="aiflow-type-meta mb-1 text-muted-foreground">
                      允许地址
                    </dt>
                    <dd className="break-all font-mono leading-5 text-muted-foreground">
                      {endpoint.baseUrl}
                    </dd>
                  </div>
                  <div>
                    <dt className="aiflow-type-meta mb-1 text-muted-foreground">
                      认证方式
                    </dt>
                    <dd className="break-words text-muted-foreground">
                      {endpoint.hasSecretRef
                        ? `${endpoint.authScheme || "原值"} · ${endpoint.authHeaderName || "Authorization"}`
                        : "无密钥"}
                    </dd>
                  </div>
                </dl>
                {canManage && (
                  <Button
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto min-[1024px]:min-h-10"
                    aria-label={`${endpoint.status === "active" ? "停用" : "启用"}服务端点：${endpoint.name}（${endpoint.refCode}）`}
                    disabled={setStatus.isPending}
                    onClick={() => requestStatusChange(endpoint)}
                  >
                    {endpoint.status === "active" ? "停用端点" : "启用端点"}
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
        {!loading && endpoints.length > 0 && (
          <div className="hidden overflow-x-auto lg:block">
            <table className="aiflow-type-body min-w-[980px] w-full text-left">
              <thead className="aiflow-type-body bg-muted text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">EndpointRef</th>
                  <th className="px-4 py-3 whitespace-nowrap">名称</th>
                  <th className="px-4 py-3 whitespace-nowrap">目标环境</th>
                  <th className="px-4 py-3 whitespace-nowrap">允许地址</th>
                  <th className="px-4 py-3 whitespace-nowrap">认证</th>
                  <th className="px-4 py-3 whitespace-nowrap">状态</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map(endpoint => (
                  <tr key={endpoint.id} className="border-t border-border">
                    <td className="aiflow-type-meta px-4 py-3 font-mono font-semibold text-aiflow-info whitespace-nowrap">
                      {endpoint.refCode}
                    </td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {endpoint.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {renderTargetEnvironment(endpoint)}
                    </td>
                    <td className="aiflow-type-body max-w-[340px] truncate px-4 py-3 font-mono text-muted-foreground">
                      {endpoint.baseUrl}
                    </td>
                    <td className="aiflow-type-body px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {endpoint.hasSecretRef
                        ? `${endpoint.authScheme || "原值"} · ${endpoint.authHeaderName || "Authorization"}`
                        : "无密钥"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`aiflow-type-meta rounded px-2 py-1 ${endpoint.status === "active" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-muted text-muted-foreground"}`}
                      >
                        {endpoint.status === "active" ? "启用" : "停用"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canManage && (
                        <button
                          type="button"
                          aria-label={`${endpoint.status === "active" ? "停用" : "启用"}服务端点：${endpoint.name}（${endpoint.refCode}）`}
                          className="aiflow-type-control inline-flex min-h-11 items-center px-2 text-aiflow-info hover:underline min-[1024px]:min-h-10"
                          disabled={setStatus.isPending}
                          onClick={() => requestStatusChange(endpoint)}
                        >
                          {endpoint.status === "active" ? "停用" : "启用"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CreationDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        title="新增项目服务端点"
        description="登记服务地址和密钥引用，供当前业务的流程调用；请勿填写实际密钥。"
        submitLabel="保存端点"
        pending={create.isPending}
        onSubmit={submitCreate}
      >
        <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
          <span>端点引用名</span>
          <Input
            id="service-endpoint-ref-code"
            className="min-h-11 text-sm min-[1024px]:min-h-10"
            placeholder="例如 CRM_API"
            minLength={2}
            maxLength={64}
            pattern="[A-Za-z][A-Za-z0-9_]{1,63}"
            title="以英文字母开头，只能包含字母、数字和下划线（2–64 位）"
            value={form.refCode}
            onChange={event =>
              setForm({ ...form, refCode: event.target.value.toUpperCase() })
            }
            required
          />
        </label>
        <p className="aiflow-type-body -mt-2 leading-5 text-muted-foreground">
          2–64位字母、数字或下划线，以字母开头，自动转为大写。
        </p>
        <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
          <span>端点名称</span>
          <Input
            id="service-endpoint-name"
            className="min-h-11 text-sm min-[1024px]:min-h-10"
            placeholder="例如 CRM 查询服务"
            maxLength={160}
            value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
          <span>基础地址</span>
          <Input
            id="service-endpoint-base-url"
            className="min-h-11 text-sm min-[1024px]:min-h-10"
            type="url"
            placeholder="https://api.example.com/v1/"
            maxLength={2048}
            title="仅允许 HTTP/HTTPS；不能包含用户名或密码，且端口只能为 80 或 443"
            value={form.baseUrl}
            onChange={event =>
              setForm({ ...form, baseUrl: event.target.value })
            }
            required
          />
        </label>
        <p className="aiflow-type-body -mt-2 leading-5 text-muted-foreground">
          仅支持HTTP/HTTPS及80、443端口；地址不得含账号密码，调用时会拒绝私网地址。
        </p>
        <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
          <span>目标环境</span>
          <select
            id="service-endpoint-target-environment"
            className="aiflow-type-control min-h-11 w-full rounded border border-border bg-card px-2 min-[1024px]:min-h-10"
            value={form.targetEnvironment}
            onChange={event =>
              setForm({
                ...form,
                targetEnvironment: event.target.value as
                  | ServiceEndpointTargetEnvironment
                  | "",
              })
            }
            required
          >
            <option value="">请选择目标环境</option>
            {SERVICE_ENDPOINT_ENVIRONMENTS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="aiflow-type-body -mt-2 rounded-md border border-aiflow-warning-border bg-aiflow-warning-surface px-3 py-2 text-aiflow-warning">
          环境标签不改变调用地址，也不提供网络隔离。
        </p>
        <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
          <span>SecretRef（可选）</span>
          <Input
            id="service-endpoint-secret-ref"
            className="min-h-11 text-sm min-[1024px]:min-h-10"
            placeholder="例如 env:FLOW_SECRET_CRM_TOKEN"
            maxLength={144}
            pattern="env:FLOW_SECRET_[A-Z0-9_]{2,128}"
            title="只能引用 env:FLOW_SECRET_ 开头的环境变量；不要在此输入密钥值"
            value={form.secretRef}
            onChange={event =>
              setForm({ ...form, secretRef: event.target.value })
            }
          />
        </label>
        {form.secretRef.trim() ? (
          <div className="rounded-lg border border-border bg-muted p-3">
            <div className="mb-3">
              <p className="aiflow-type-body font-semibold text-foreground">
                认证请求配置
              </p>
              <p className="aiflow-type-body mt-1 leading-5 text-muted-foreground">
                调用时使用引用的密钥，按以下方式添加认证请求头。
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
                <span>认证请求头</span>
                <Input
                  id="service-endpoint-auth-header"
                  className="min-h-11 text-sm min-[1024px]:min-h-10"
                  placeholder="Authorization"
                  maxLength={128}
                  pattern="[A-Za-z0-9-]{1,128}"
                  title="请求头名称仅可包含英文字母、数字和连字符"
                  value={form.authHeaderName}
                  onChange={event =>
                    setForm({ ...form, authHeaderName: event.target.value })
                  }
                />
              </label>
              <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
                <span>认证方案</span>
                <Input
                  id="service-endpoint-auth-scheme"
                  className="min-h-11 text-sm min-[1024px]:min-h-10"
                  placeholder="Bearer"
                  maxLength={32}
                  pattern="[A-Za-z][A-Za-z0-9._-]{0,31}"
                  title="认证方案以英文字母开头，最多 32 个字符"
                  value={form.authScheme}
                  onChange={event =>
                    setForm({ ...form, authScheme: event.target.value })
                  }
                />
              </label>
            </div>
          </div>
        ) : (
          <p className="aiflow-type-body rounded-lg border border-dashed border-border bg-muted px-3 py-2 leading-5 text-muted-foreground">
            未填写密钥引用：调用不附加认证请求头。
          </p>
        )}
        <p className="aiflow-type-body leading-5 text-muted-foreground">
          保存后，在流程节点中填写端点引用名（EndpointRef）和相对路径。
        </p>
      </CreationDialog>
      <AlertDialog
        open={Boolean(statusConfirmation)}
        onOpenChange={open => {
          if (!open && !setStatus.isPending) setStatusConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusConfirmation?.status === "disabled"
                ? "确认停用服务端点"
                : "确认启用服务端点"}
            </AlertDialogTitle>
            <AlertDialogDescription className="aiflow-type-body leading-6">
              {statusConfirmation?.status === "disabled"
                ? `将停用“${statusConfirmation.name}”（${statusConfirmation.refCode}）。后续引用此 EndpointRef 的任务将无法解析端点并执行失败；流程定义和历史记录会保留。`
                : `将启用“${statusConfirmation?.name}”（${statusConfirmation?.refCode}）。使用此 EndpointRef 的流程可以再次调用已登记的外部地址；本次操作不会立即发送外部请求。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="aiflow-type-control h-11 min-h-11"
              disabled={setStatus.isPending}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className={`aiflow-type-control h-11 min-h-11 ${statusConfirmation?.status === "disabled" ? "bg-rose-600 text-white hover:bg-rose-700" : ""}`}
              disabled={!statusConfirmation || setStatus.isPending}
              onClick={event => {
                event.preventDefault();
                if (!statusConfirmation) return;
                setStatus.mutate({
                  projectId,
                  id: statusConfirmation.id,
                  status: statusConfirmation.status,
                });
              }}
            >
              {setStatus.isPending
                ? "正在更新…"
                : statusConfirmation?.status === "disabled"
                  ? "确认停用"
                  : "确认启用"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type ProcessCenterProps = {
  project: ProjectRecord;
  workflows: any[];
  filters: ProcessFilters;
  setFilters: (value: ProcessFilters) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  onRefreshWorkflows: () => void;
  refreshingWorkflows: boolean;
  workflowLoadFailed: boolean;
  actionsReady: boolean;
  showCreate: boolean;
  setShowCreate: (value: boolean) => void;
  form: {
    processCode: string;
    name: string;
    description: string;
    flowType: "state" | "control" | "data";
    creationSource: "manual" | "warehouse";
    dataSourceId: string;
  };
  setForm: (value: any) => void;
  dataSources: any[];
  canCreate: boolean;
  canManage: boolean;
  creating: boolean;
  onCreate: () => void;
  onOpenWorkflow: (workflowId: string) => void;
  onOpenWarehouse: () => void;
  onLaunch: (workflow: any) => void;
  onDetail: (workflowId: string) => void;
};

function WorkflowListEmptyState({
  countMismatch,
  reportedCount,
  canCreate,
  refreshing,
  loadFailed,
  onRefresh,
}: {
  countMismatch: boolean;
  reportedCount: number;
  canCreate: boolean;
  refreshing: boolean;
  loadFailed: boolean;
  onRefresh: () => void;
}) {
  if (countMismatch || loadFailed)
    return (
      <div
        role="status"
        aria-live="polite"
        data-project-workflow-count-mismatch
        data-project-workflow-list-load-error={loadFailed ? "true" : undefined}
        className="space-y-2"
      >
        <p className="aiflow-type-body font-medium text-aiflow-warning">
          {loadFailed
            ? "流程列表读取失败，项目概览数量暂时无法核实。"
            : `项目概览显示 ${reportedCount} 个流程，当前列表返回 0 条。`}
        </p>
        <p className="aiflow-type-body text-muted-foreground">
          {loadFailed
            ? "请重试；如仍失败，请核对项目流程归属与查看权限。"
            : "请重新读取，或核对项目流程归属与查看权限。"}
        </p>
        <Button
          type="button"
          variant="outline"
          className="aiflow-type-control min-h-11"
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? "正在读取…" : loadFailed ? "重试读取" : "重新读取"}
        </Button>
      </div>
    );

  return (
    <div>
      <p className="aiflow-type-body">项目内暂无匹配流程。</p>
      {canCreate && (
        <p className="aiflow-type-body mt-1">可重置筛选或从右上角新建流程。</p>
      )}
    </div>
  );
}

function ProcessCenter({
  project,
  workflows,
  filters,
  setFilters,
  onApplyFilters,
  onResetFilters,
  onRefreshWorkflows,
  refreshingWorkflows,
  workflowLoadFailed,
  actionsReady,
  showCreate,
  setShowCreate,
  form,
  setForm,
  dataSources,
  canCreate,
  canManage,
  creating,
  onCreate,
  onOpenWorkflow,
  onOpenWarehouse,
  onLaunch: startDataflow,
  onDetail,
}: ProcessCenterProps) {
  const utils = trpc.useUtils();
  const hasWorkflowFilters = Boolean(
    filters.flowType ||
      filters.auditStatus ||
      filters.status ||
      filters.keyword?.trim()
  );
  const workflowCountMismatch =
    !workflowLoadFailed &&
    !hasWorkflowFilters &&
    typeof project.workflowCount === "number" &&
    project.workflowCount > workflows.length;
  const refreshWorkflows = () => {
    void utils.project.workflows.invalidate({ projectId: project.id });
    void utils.project.access.invalidate({ projectId: project.id });
    void utils.workflow.list.invalidate();
    void utils.workflow.page.invalidate();
    void utils.workflow.get.invalidate();
    void utils.workflow.access.invalidate();
  };
  const publish = trpc.workflow.publish.useMutation({
    onSuccess: () => {
      refreshWorkflows();
      toast.success("流程已发布。");
    },
    onError: error => { refreshWorkflows(); toast.error(error.message); },
  });
  const unpublish = trpc.workflow.unpublish.useMutation({
    onSuccess: () => {
      refreshWorkflows();
      toast.success("流程已取消发布；版本与运行审计已保留。");
    },
    onError: error => { refreshWorkflows(); toast.error(error.message); },
  });
  const [launchWorkflow, setLaunchWorkflow] = useState<any | null>(null);
  const [openWorkflowActionsId, setOpenWorkflowActionsId] = useState<
    string | null
  >(null);
  const [launchForm, setLaunchForm] = useState({
    codeType: "UserWord",
    expectedEnd: "",
    roleKeys: "",
    businessInformationOne: "",
    businessInformationTwo: "",
    businessInformationThree: "",
    businessInformationText: "",
  });
  const [review, setReview] = useState<{ workflow: any; decision: "approved" | "rejected" } | null>(null);
  const [auditWorkflowId, setAuditWorkflowId] = useState<string | null>(null);
  const [approvalSelectorOpen, setApprovalSelectorOpen] = useState(false);
  const approvalHistory = trpc.project.workflowAudit.useQuery(
    { projectId: project.id, workflowId: auditWorkflowId ?? "00000000" },
    { enabled: Boolean(auditWorkflowId), retry: false }
  );
  const launch = trpc.workflow.run.useMutation({
    onSuccess: result => {
      setLaunchWorkflow(null);
      toast.success(`流程已发起：${result.runId.slice(0, 8)}`);
    },
    onError: error => { refreshWorkflows(); toast.error(error.message); },
  });
  const actionsFor = (workflow: any) => actionsReady ? workflow?.actions ?? {} : {};
  const launchAllowed = actionsFor(workflows.find(item => item.id === launchWorkflow?.id)).canRun === true;
  const onLaunch = (workflow: any) => {
    if (!actionsFor(workflow).canRun) return;
    if (workflow.flowType === "data") {
      startDataflow(workflow);
      return;
    }
    setLaunchForm({
      codeType: "UserWord",
      expectedEnd: "",
      roleKeys: "",
      businessInformationOne: "",
      businessInformationTwo: "",
      businessInformationThree: "",
      businessInformationText: "",
    });
    setLaunchWorkflow(workflow);
  };
  const sourceNameById = new Map(
    dataSources.map(source => [source.id, source.name])
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(workflows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageWorkflows = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return workflows.slice(startIndex, startIndex + pageSize);
  }, [currentPage, pageSize, workflows]);
  const advancedFilterCount =
    Number(Boolean(filters.auditStatus)) + Number(Boolean(filters.status));

  useEffect(() => {
    setPage(1);
  }, [workflows]);

  const renderPrimaryActions = (workflow: any, surface: "table" | "card") => {
    const actions = actionsFor(workflow);
    const canvasLabel = actions.canDesign ? "设计流程" : "查看画布";
    const runLabel = workflow.flowType === "data" ? "执行数据流程" : "发起流程";
    const sizing = surface === "card" ? "h-11 min-h-11 flex-1" : "h-9";
    return <>
      {actions.canViewCanvas && <Button type="button" variant={actions.canRun ? "outline" : "default"} size="sm" className={`aiflow-type-control ${sizing} px-3 font-semibold`} aria-label={`${canvasLabel}：${workflow.name}`} onClick={() => onOpenWorkflow(workflow.id)}>{canvasLabel}</Button>}
      {actions.canRun && <Button type="button" size="sm" className={`aiflow-type-control ${sizing} px-3 font-semibold`} aria-label={`${runLabel}：${workflow.name}`} onClick={() => onLaunch(workflow)}>{runLabel}</Button>}
    </>;
  };

  const renderMoreActions = (workflow: any, surface: "table" | "card") => {
    const actionPopoverId = `${surface}:${workflow.id}`;
    return (
      <Popover
        open={openWorkflowActionsId === actionPopoverId}
        onOpenChange={open =>
          setOpenWorkflowActionsId(open ? actionPopoverId : null)
        }
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="aiflow-type-control min-h-11 gap-1.5 px-3 sm:h-9 sm:min-h-0"
            aria-label={`更多信息与操作：${workflow.name}`}
            title="更多信息与操作"
          >
            <MoreHorizontal aria-hidden="true" size={16} />
            <span>更多</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={8}
          className="flex w-[min(24rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-0"
          style={{
            maxHeight:
              "min(70vh, 36rem, var(--radix-popover-content-available-height))",
          }}
        >
          <div className="min-h-0 overflow-y-auto px-4 py-3">
            <h3 className="aiflow-type-body font-semibold text-foreground">
              流程信息
            </h3>
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="aiflow-type-meta text-muted-foreground">
                  流程名称
                </dt>
                <dd className="aiflow-type-body mt-0.5 break-words font-medium text-foreground">
                  {workflow.name}
                </dd>
              </div>
              <div>
                <dt className="aiflow-type-meta text-muted-foreground">
                  流程代号
                </dt>
                <dd className="aiflow-type-meta mt-0.5 break-all font-mono text-foreground">
                  {workflowCode(workflow)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="aiflow-type-meta text-muted-foreground">
                  流程说明
                </dt>
                <dd className="aiflow-type-body mt-0.5 break-words text-foreground">
                  {workflow.description || "未填写流程说明"}
                </dd>
              </div>
              <div>
                <dt className="aiflow-type-meta text-muted-foreground">
                  关联数据源
                </dt>
                <dd className="aiflow-type-body mt-0.5 break-words text-foreground">
                  {workflow.flowType !== "data"
                    ? "不适用"
                    : workflow.dataSourceId
                      ? sourceNameById.get(workflow.dataSourceId) ||
                        "已关联数据源"
                      : "未关联"}
                </dd>
              </div>
              <div>
                <dt className="aiflow-type-meta text-muted-foreground">
                  创建人
                </dt>
                <dd className="aiflow-type-body mt-0.5 break-words text-foreground">
                  {workflow.creatorName || workflow.creatorUsername || "—"}
                </dd>
              </div>
              <div>
                <dt className="aiflow-type-meta text-muted-foreground">
                  创建时间
                </dt>
                <dd className="aiflow-type-meta mt-0.5 tabular-nums text-foreground">
                  {formatDate(workflow.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="aiflow-type-meta text-muted-foreground">
                  创建来源
                </dt>
                <dd className="aiflow-type-body mt-0.5 text-foreground">
                  {workflow.creationSource === "warehouse"
                    ? "仓库导入"
                    : "手工创建"}
                </dd>
              </div>
              <div>
                <dt className="aiflow-type-meta text-muted-foreground">
                  最近发布时间
                </dt>
                <dd className="aiflow-type-meta mt-0.5 tabular-nums text-foreground">
                  {workflow.publishedAt
                    ? formatDate(workflow.publishedAt)
                    : "尚未发布"}
                </dd>
              </div>
              <div>
                <dt className="aiflow-type-meta text-muted-foreground">
                  最近取消发布时间
                </dt>
                <dd className="aiflow-type-meta mt-0.5 tabular-nums text-foreground">
                  {workflow.unpublishedAt
                    ? formatDate(workflow.unpublishedAt)
                    : "尚未取消发布"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-border bg-popover p-3">
            <button
              type="button"
              className="aiflow-type-control min-h-11 rounded-md border border-border bg-card px-3 py-2 text-foreground hover:bg-muted sm:min-h-0 sm:px-2.5 sm:py-1.5"
              onClick={() => {
                setOpenWorkflowActionsId(null);
                onDetail(workflow.id);
              }}
            >
              查看详情
            </button>
            {[
              { allowed: actionsFor(workflow).canPublish, label: "发布流程", tone: "success", run: () => publish.mutate({ id: workflow.id, expectedDefinitionVersion: Number(workflow.definitionVersion) }) },
              { allowed: actionsFor(workflow).canUnpublish, label: "取消发布", tone: "warning", run: () => unpublish.mutate({ id: workflow.id, expectedDefinitionVersion: Number(workflow.definitionVersion) }) },
              { allowed: actionsFor(workflow).canReview, label: "审核通过", tone: "success", run: () => setReview({ workflow: workflowReviewSnapshot(workflow), decision: "approved" }) },
              { allowed: actionsFor(workflow).canReview, label: "审核驳回", tone: "danger", run: () => setReview({ workflow: workflowReviewSnapshot(workflow), decision: "rejected" }) },
            ].filter(action => action.allowed).map(action => (
              <button key={action.label} type="button" disabled={publish.isPending || unpublish.isPending}
                className={`aiflow-type-control min-h-11 rounded-md border bg-card px-3 py-2 sm:min-h-0 sm:px-2.5 sm:py-1.5 ${action.tone === "success" ? "border-aiflow-success-border text-aiflow-success hover:bg-aiflow-success-surface" : action.tone === "warning" ? "border-aiflow-warning-border text-aiflow-warning hover:bg-aiflow-warning-surface" : "border-red-200 text-red-600 hover:bg-red-50"}`}
                onClick={() => { setOpenWorkflowActionsId(null); action.run(); }}
              >{action.label}</button>
            ))}
            {(actionsFor(workflow).reviewBlockedReason || actionsFor(workflow).publishBlockedReason) && <p role="status" className="aiflow-type-body text-muted-foreground">{actionsFor(workflow).reviewBlockedReason || actionsFor(workflow).publishBlockedReason}</p>}
            {actionsFor(workflow).canPublish && actionsFor(workflow).publicationRule?.requireProjectApproval === false && <p role="status" className="aiflow-type-body text-muted-foreground">当前规则无需审核，可直接发布此草稿。</p>}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div>
      <div
        data-aiflow-context-header
        className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <p className="aiflow-type-body hidden text-muted-foreground sm:block">
            管理当前业务内的流程生命周期
          </p>
          <h1 className="aiflow-type-page-title mt-0.5 font-semibold tracking-tight text-foreground">
            流程管理
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenWarehouse}
            className="aiflow-type-control h-11 gap-1 border-border px-2 hover:bg-muted sm:h-8"
          >
            <Upload
              size={13}
              className="hidden text-muted-foreground sm:block"
            />
            上传仓库
          </Button>
          {workflows.length > 0 && (
            <Popover
              open={approvalSelectorOpen}
              onOpenChange={setApprovalSelectorOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="aiflow-type-control h-11 gap-1 rounded-md border-border bg-card px-2 font-medium text-foreground hover:bg-muted sm:h-8"
                  aria-expanded={approvalSelectorOpen}
                >
                  审批记录
                  <ChevronDown aria-hidden="true" size={14} />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="bottom"
                sideOffset={8}
                collisionPadding={12}
                className="w-[min(18rem,calc(100vw-1.5rem))] p-3"
              >
                <label className="aiflow-type-control grid gap-1.5 font-medium text-muted-foreground">
                  选择流程
                  <select
                    aria-label="选择流程查看审批记录"
                    className="h-11 min-w-0 rounded-md border border-border bg-card px-2 text-sm text-foreground sm:h-9"
                    value={auditWorkflowId ?? ""}
                    onChange={event => {
                      setApprovalSelectorOpen(false);
                      setAuditWorkflowId(event.target.value || null);
                    }}
                  >
                    <option value="">请选择流程</option>
                    {workflows.map(workflow => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.processCode || workflow.name}
                      </option>
                    ))}
                  </select>
                </label>
              </PopoverContent>
            </Popover>
          )}
          {canCreate && (
            <Button
              type="button"
              size="sm"
              className="aiflow-type-control h-11 gap-1 bg-slate-900 px-2 font-medium text-white shadow-2xs hover:bg-slate-800 sm:h-8"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={14} className="hidden sm:block" />
              新增流程
            </Button>
          )}
        </div>
      </div>
      <PermissionListFeedback name="流程操作权限" loading={!actionsReady && !workflowLoadFailed} error={workflowLoadFailed} onRetry={onRefreshWorkflows} />
      <CreationDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        title="新增流程"
        description="创建当前业务的流程草稿；从仓库导入将转到仓库页面。"
        submitLabel={
          form.creationSource === "warehouse" ? "前往流程仓库" : "创建并设计"
        }
        pending={creating}
        onSubmit={onCreate}
      >
        <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
          <span>流程代号</span>
          <Input
            id="new-workflow-code"
            className="aiflow-type-control min-h-11 min-[1024px]:min-h-9"
            placeholder="例如 ORDER_APPROVAL"
            value={form.processCode}
            onChange={event =>
              setForm({
                ...form,
                processCode: event.target.value.toUpperCase(),
              })
            }
            required
          />
        </label>
        <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
          <span>流程名称</span>
          <Input
            id="new-workflow-name"
            className="aiflow-type-control min-h-11 min-[1024px]:min-h-9"
            placeholder="例如 采购审批"
            value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label className="aiflow-type-control block space-y-1 font-medium text-muted-foreground">
          <span>流程说明（可选）</span>
          <Input
            id="new-workflow-description"
            className="aiflow-type-control min-h-11 min-[1024px]:min-h-9"
            placeholder="说明流程用途，便于列表筛选和协作"
            value={form.description}
            onChange={event =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>
        <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
          <span>流程类型</span>
          <select
            id="new-workflow-type"
            className="aiflow-type-control min-h-11 rounded-md border border-border bg-card px-2 min-[1024px]:min-h-9"
            value={form.flowType}
            onChange={event =>
              setForm({
                ...form,
                flowType: event.target.value as typeof form.flowType,
                dataSourceId:
                  event.target.value === "data" ? form.dataSourceId : "",
              })
            }
          >
            <option value="state">状态流程</option>
            <option value="control">控制流程</option>
            <option value="data">数据流程</option>
          </select>
        </label>
        <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
          <span>创建方式</span>
          <select
            id="new-workflow-source"
            className="aiflow-type-control min-h-11 rounded-md border border-border bg-card px-2 min-[1024px]:min-h-9"
            value={form.creationSource}
            onChange={event =>
              setForm({
                ...form,
                creationSource: event.target
                  .value as typeof form.creationSource,
              })
            }
          >
            <option value="manual">手工创建</option>
            <option value="warehouse">从仓库导入</option>
          </select>
        </label>
        {form.creationSource === "manual" && form.flowType === "data" && (
          <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
            <span>关联数据源（可选）</span>
            <select
              id="new-workflow-data-source"
              className="aiflow-type-control min-h-11 rounded-md border border-border bg-card px-2 min-[1024px]:min-h-9"
              value={form.dataSourceId}
              onChange={event =>
                setForm({ ...form, dataSourceId: event.target.value })
              }
            >
              <option value="">不关联数据源</option>
              {dataSources
                .filter(source => source.status !== "disabled")
                .map(source => (
                  <option key={source.id} value={source.id}>
                    {source.name} · {source.sourceType}
                  </option>
                ))}
            </select>
          </label>
        )}
        <p className="aiflow-type-body leading-5 text-muted-foreground">
          流程代号在当前业务内唯一。数据流程可选择当前业务未停用的数据源。
        </p>
      </CreationDialog>
      <div className="mb-4 rounded-lg border border-border bg-card shadow-2xs">
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto_auto]">
          <Input
            className="h-11 min-w-0 text-sm max-[374px]:col-span-2 sm:col-span-1 sm:h-9"
            placeholder="搜索流程名称或说明"
            value={filters.keyword ?? ""}
            onChange={event =>
              setFilters({
                ...filters,
                keyword: event.target.value || undefined,
              })
            }
            aria-label="搜索流程名称或说明"
          />
          <select
            className="h-11 min-w-0 rounded-md border border-border bg-card px-2 text-sm max-[374px]:col-span-2 sm:col-span-1 sm:h-9"
            value={filters.flowType ?? ""}
            onChange={event =>
              setFilters({
                ...filters,
                flowType: (event.target.value ||
                  undefined) as ProcessFilters["flowType"],
              })
            }
            aria-label="流程类型"
          >
            <option value="">全部类型</option>
            <option value="state">状态流程</option>
            <option value="control">控制流程</option>
            <option value="data">数据流程</option>
          </select>
          <Button
            type="button"
            size="sm"
            className="h-11 sm:h-9"
            onClick={() => {
              setPage(1);
              onApplyFilters();
            }}
          >
            查询
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 sm:h-9"
            onClick={() => {
              setPage(1);
              onResetFilters();
            }}
          >
            重置
          </Button>
        </div>
        <details className="border-t border-border px-3 py-2">
          <summary className="aiflow-type-control inline-flex min-h-11 w-fit cursor-pointer list-none items-center font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 sm:min-h-0">
            {advancedFilterCount > 0
              ? "更多筛选（已启用 " + advancedFilterCount + " 项）"
              : "更多筛选"}{" "}
            <span aria-hidden="true">▾</span>
          </summary>
          <div className="grid gap-2 pb-1 pt-3 sm:grid-cols-2">
            <label className="aiflow-type-control grid gap-1 text-muted-foreground">
              审核状态
              <select
                className="h-11 rounded-md border border-border bg-card px-2 text-sm sm:h-9"
                value={filters.auditStatus ?? ""}
                onChange={event =>
                  setFilters({
                    ...filters,
                    auditStatus: (event.target.value ||
                      undefined) as ProcessFilters["auditStatus"],
                  })
                }
              >
                <option value="">全部审核状态</option>
                <option value="init">待审核</option>
                <option value="approved">审核通过</option>
                <option value="rejected">审核驳回</option>
              </select>
            </label>
            <label className="aiflow-type-control grid gap-1 text-muted-foreground">
              发布状态
              <select
                className="h-11 rounded-md border border-border bg-card px-2 text-sm sm:h-9"
                value={filters.status ?? ""}
                onChange={event =>
                  setFilters({
                    ...filters,
                    status: (event.target.value ||
                      undefined) as ProcessFilters["status"],
                  })
                }
              >
                <option value="">全部发布状态</option>
                <option value="draft">未发布</option>
                <option value="published">已发布</option>
              </select>
            </label>
          </div>
        </details>
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[960px] text-left">
            <thead className="bg-muted text-sm font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">流程</th>
                <th className="px-4 py-3 whitespace-nowrap">类型</th>
                <th className="px-4 py-3 whitespace-nowrap">审核</th>
                <th className="px-4 py-3 whitespace-nowrap">发布状态</th>
                <th className="px-4 py-3 whitespace-nowrap">更新时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {pageWorkflows.map((workflow: any) => (
                <tr
                  key={workflow.id}
                  data-project-workflow-row={workflow.id}
                  className="group border-t border-border align-middle hover:bg-aiflow-info-surface/40"
                >
                  <td className="max-w-[360px] px-4 py-3">
                    <p
                      aria-label={workflow.name}
                      className="aiflow-type-body min-w-0 break-words font-medium text-foreground"
                      title={workflow.name}
                    >
                      {displayWorkflowName(workflow.name)}
                    </p>
                    {getOptionalWorkflowDescription(workflow.description) && (
                      <p
                        className="aiflow-type-body mt-1 line-clamp-2 break-words text-muted-foreground"
                        title={getOptionalWorkflowDescription(
                          workflow.description
                        )}
                      >
                        {getOptionalWorkflowDescription(workflow.description)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={
                        "inline-flex rounded px-2.5 py-1 text-xs " +
                        (flowTypeStyle[
                          workflow.flowType as keyof typeof flowTypeStyle
                        ] ?? "bg-muted text-muted-foreground")
                      }
                    >
                      {displayFlowType(workflow.flowType)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs">
                    <span
                      className={
                        workflow.auditStatus === "approved"
                          ? "text-aiflow-success"
                          : workflow.auditStatus === "rejected"
                            ? "text-red-600"
                            : "text-aiflow-warning"
                      }
                    >
                      <CircleDot className="mr-1 inline" size={12} />
                      {displayAuditStatus(workflow.auditStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={
                        workflow.status === "published"
                          ? "inline-flex rounded border border-aiflow-info-border bg-aiflow-info-surface px-2.5 py-1 text-xs text-aiflow-info"
                          : "inline-flex rounded border border-border px-2.5 py-1 text-xs text-muted-foreground"
                      }
                    >
                      {workflow.status === "published" ? "已发布" : "未发布"}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {formatDate(workflow.updatedAt)}
                  </td>
                  <td className="min-w-[170px] px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      {renderPrimaryActions(workflow, "table")}
                      {renderMoreActions(workflow, "table")}
                    </div>
                  </td>
                </tr>
              ))}
              {!workflows.length && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-14 text-center text-sm text-muted-foreground"
                  >
                    <WorkflowListEmptyState
                      countMismatch={workflowCountMismatch}
                      reportedCount={project.workflowCount ?? 0}
                      canCreate={canCreate}
                      refreshing={refreshingWorkflows}
                      loadFailed={workflowLoadFailed}
                      onRefresh={onRefreshWorkflows}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 p-3 xl:hidden">
          {pageWorkflows.map((workflow: any) => (
            <article
              key={workflow.id}
              data-project-workflow-row={workflow.id}
              className="min-w-0 rounded-lg border border-border bg-card p-3.5 shadow-2xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2
                    aria-label={workflow.name}
                    title={workflow.name}
                    className="aiflow-type-card-title mt-1 break-words font-semibold text-foreground"
                  >
                    {displayWorkflowName(workflow.name)}
                  </h2>
                </div>
                <span
                  className={
                    workflow.status === "published"
                      ? "inline-flex rounded border border-aiflow-info-border bg-aiflow-info-surface px-2 py-1 text-xs text-aiflow-info"
                      : "inline-flex rounded border border-border px-2 py-1 text-xs text-muted-foreground"
                  }
                >
                  {workflow.status === "published" ? "已发布" : "未发布"}
                </span>
              </div>
              {getOptionalWorkflowDescription(workflow.description) && (
                <p className="aiflow-type-body mt-2 line-clamp-2 break-words text-muted-foreground">
                  {getOptionalWorkflowDescription(workflow.description)}
                </p>
              )}
              <div className="aiflow-type-meta mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={
                    "rounded px-2 py-1 " +
                    (flowTypeStyle[
                      workflow.flowType as keyof typeof flowTypeStyle
                    ] ?? "bg-muted text-muted-foreground")
                  }
                >
                  {displayFlowType(workflow.flowType)}
                </span>
                <span
                  className={
                    workflow.auditStatus === "approved"
                      ? "text-aiflow-success"
                      : workflow.auditStatus === "rejected"
                        ? "text-red-600"
                        : "text-aiflow-warning"
                  }
                >
                  <CircleDot className="mr-1 inline" size={12} />
                  {displayAuditStatus(workflow.auditStatus)}
                </span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  更新于 {formatDate(workflow.updatedAt)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                      {renderPrimaryActions(workflow, "card")}
                      {renderMoreActions(workflow, "card")}
              </div>
            </article>
          ))}
          {!workflows.length && (
            <div className="rounded-lg border border-dashed border-input bg-card px-4 py-12 text-center text-sm text-muted-foreground">
              <WorkflowListEmptyState
                countMismatch={workflowCountMismatch}
                reportedCount={project.workflowCount ?? 0}
                canCreate={canCreate}
                refreshing={refreshingWorkflows}
                loadFailed={workflowLoadFailed}
                onRefresh={onRefreshWorkflows}
              />
            </div>
          )}
        </div>
        <footer className="aiflow-type-meta flex flex-col gap-2 border-t border-border bg-card px-4 py-3 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span aria-live="polite">
            显示第 {workflows.length ? (currentPage - 1) * pageSize + 1 : 0}–
            {Math.min(currentPage * pageSize, workflows.length)} 条，共{" "}
            {workflows.length} 条流程
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              每页
              <select
                className="aiflow-type-control h-11 rounded-md border border-border bg-card px-2 sm:h-8"
                value={pageSize}
                onChange={event => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                aria-label="每页显示流程数量"
              >
                <option value={10}>10 条</option>
                <option value={25}>25 条</option>
                <option value={50}>50 条</option>
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="aiflow-type-control h-8"
              disabled={currentPage <= 1}
              onClick={() => setPage(value => Math.max(1, value - 1))}
            >
              上一页
            </Button>
            <span
              className="min-w-12 text-center font-mono tabular-nums"
              aria-current="page"
            >
              {currentPage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="aiflow-type-control h-8"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(value => Math.min(totalPages, value + 1))}
            >
              下一页
            </Button>
          </div>
        </footer>
      </section>
      {launchWorkflow && (
        <ProcessLaunchDialog
          workflow={launchWorkflow}
          form={launchForm}
          setForm={setLaunchForm}
          pending={launch.isPending}
          allowed={launchAllowed}
          onRefresh={onRefreshWorkflows}
          refreshing={refreshingWorkflows}
          onClose={() => setLaunchWorkflow(null)}
          onSubmit={() => {
            if (!launchAllowed || launch.isPending) return;
            launch.mutate({
              workflowId: launchWorkflow.id,
              input: {
                codeType: launchForm.codeType,
                flowEngine: true,
                flowModuleId: launchWorkflow.id,
                startNodeId: "",
                flowDeliveryTime: launchForm.expectedEnd
                  ? new Date(launchForm.expectedEnd).toISOString()
                  : "",
                businessId: project.id,
                roleKeys: launchForm.roleKeys.split(/[，,\s]+/).filter(Boolean),
                businessInformationOne:
                  launchForm.businessInformationOne.trim(),
                businessInformationTwo:
                  launchForm.businessInformationTwo.trim(),
                businessInformationThree:
                  launchForm.businessInformationThree.trim(),
                businessInformationText:
                  launchForm.businessInformationText.trim(),
              },
            });
          }}
        />
      )}
      {review && <Suspense fallback={<Dialog open onOpenChange={open => { if (!open) setReview(null); }}>
        <DialogContent><DialogHeader><DialogTitle>正在加载审核确认</DialogTitle><DialogDescription>正在准备此流程版本的复核信息…</DialogDescription></DialogHeader>
          <Loader2 className="animate-spin" aria-hidden="true" /><Button type="button" variant="outline" onClick={() => setReview(null)}>取消</Button>
        </DialogContent></Dialog>}>
        <WorkflowReviewDialog projectId={project.id} initial={review.workflow} decision={review.decision}
          onClose={() => setReview(null)} onViewDefinition={onOpenWorkflow} />
      </Suspense>}

      {auditWorkflowId && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setAuditWorkflowId(null);
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>审批记录</DialogTitle>
              <DialogDescription>
                仅展示当前业务内所选流程的审核与审核重置审计，不包含全局身份审计。
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
              {approvalHistory.isLoading && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  正在读取审批记录…
                </p>
              )}
              {!approvalHistory.isLoading &&
                !(approvalHistory.data ?? []).length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    暂无审批记录。
                  </p>
                )}
              {(approvalHistory.data ?? []).map((entry: any) => (
                <div
                  key={entry.id}
                  className="border-l-2 border-aiflow-info bg-muted px-3 py-2.5"
                >
                  <p className="aiflow-type-body font-medium text-foreground">
                    {entry.operation === "workflow_audit_reset"
                      ? "重置审核状态"
                      : entry.details?.auditStatus === "approved"
                        ? "审核通过"
                        : "审核驳回"}
                  </p>
                  <p className="aiflow-type-meta mt-1 text-muted-foreground">
                    {Number.isSafeInteger(Number(entry.details?.definitionVersion)) && Number(entry.details?.definitionVersion) > 0
                      ? `定义 v${Number(entry.details?.definitionVersion)}` : "旧记录未提供版本"}
                  </p>
                  <p className="aiflow-type-meta mt-1 text-muted-foreground">
                    {entry.actorName || entry.actorUsername || "系统"} ·{" "}
                    {formatDate(entry.createdAt)}
                  </p>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setAuditWorkflowId(null)}>
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ProcessLaunchDialog({
  workflow,
  form,
  setForm,
  pending,
  allowed,
  refreshing,
  onRefresh,
  onClose,
  onSubmit,
}: {
  workflow: any;
  form: {
    codeType: string;
    expectedEnd: string;
    roleKeys: string;
    businessInformationOne: string;
    businessInformationTwo: string;
    businessInformationThree: string;
    businessInformationText: string;
  };
  setForm: (value: {
    codeType: string;
    expectedEnd: string;
    roleKeys: string;
    businessInformationOne: string;
    businessInformationTwo: string;
    businessInformationThree: string;
    businessInformationText: string;
  }) => void;
  pending: boolean;
  allowed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [exitAction, setExitAction] = useState<(() => void) | null>(null);
  const dirty = Object.entries(form).some(
    ([key, value]) => value !== (key === "codeType" ? "UserWord" : "")
  );
  const requestClose = (action: () => void = onClose) => {
    if (pending) return;
    if (dirty) setExitAction(() => action);
    else action();
  };
  useEffect(() => {
    if (!dirty && !pending) return;
    const guardNavigation = (event: Event) => {
      event.preventDefault();
      requestClose((event as ConsoleNavigationEvent).detail.proceed);
    };
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener(consoleNavigationEvent, guardNavigation);
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener(consoleNavigationEvent, guardNavigation);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [dirty, pending]);
  return (
    <>
      <Dialog
        open
        onOpenChange={open => {
          if (!open) requestClose();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>发起流程</DialogTitle>
            <DialogDescription>
              填写原始流程发起上下文。所有字段将以受权限保护的运行输入对象提交，不需要填写
              JSON。
            </DialogDescription>
          </DialogHeader>
          {!allowed && (
            <div
              role="alert"
              className="aiflow-type-body space-y-2 text-muted-foreground"
            >
              <p>
                此流程当前无法发起，可能是权限或发布状态已变化。填写内容已保留，可刷新后继续。
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={pending || refreshing}
                onClick={onRefresh}
              >
                刷新流程权限
              </Button>
            </div>
          )}
          <fieldset
            disabled={pending || !allowed}
            className="grid min-w-0 gap-3 sm:grid-cols-2"
          >
            <label className="grid gap-1.5 text-sm text-foreground">
              发起方类型
              <select
                className="h-9 rounded border border-border bg-card px-2 text-sm"
                value={form.codeType}
                onChange={event =>
                  setForm({ ...form, codeType: event.target.value })
                }
              >
                <option value="UserWord">UserWord</option>
                <option value="UnitWord">UnitWord</option>
                <option value="AuthUnitWord">AuthUnitWord</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm text-foreground">
              流程应结束时间（可选）
              <Input
                type="datetime-local"
                value={form.expectedEnd}
                onChange={event =>
                  setForm({ ...form, expectedEnd: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm text-foreground sm:col-span-2">
              发起方角色键（可选）
              <Input
                placeholder="多个角色键用逗号或空格分隔"
                value={form.roleKeys}
                onChange={event =>
                  setForm({ ...form, roleKeys: event.target.value })
                }
              />
            </label>
            {([
              ["businessInformationOne", "业务信息一"],
              ["businessInformationTwo", "业务信息二"],
              ["businessInformationThree", "业务信息三"],
              ["businessInformationText", "业务信息说明"],
            ] as const).map(([key, label]) => (
              <label key={key} className="grid gap-1.5 text-sm text-foreground">
                {label}
                <Input value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} />
              </label>
            ))}
          </fieldset>
          <p className="aiflow-type-body text-muted-foreground">
            当前流程：{workflow.name}
            。实际发起人由服务端会话身份记录，不能由此表单伪造。
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => requestClose()}
            >
              取消
            </Button>
            <Button
              type="button"
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-2xs"
              disabled={pending || !allowed}
              onClick={onSubmit}
            >
              {pending && <Loader2 className="animate-spin" size={15} />}
              确认发起
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(exitAction)}
        onOpenChange={open => {
          if (!open) setExitAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃本次发起填写？</AlertDialogTitle>
            <AlertDialogDescription>
              已填写的发起信息尚未提交。可以继续填写，或确认放弃并关闭。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续填写</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = exitAction;
                setExitAction(null);
                action?.();
              }}
            >
              放弃并关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProjectMembers({
  projectId,
  members,
  membersLoading,
  membersError,
  onRetryMembers,
  canManage,
  viewAllowed,
  onRefreshAccess,
}: {
  projectId: string;
  members: any[];
  membersLoading: boolean;
  membersError: boolean;
  onRetryMembers: () => void;
  canManage: boolean;
  viewAllowed: boolean;
  onRefreshAccess: () => Promise<unknown>;
}) {
  const utils = trpc.useUtils();
  const projectUnits = trpc.project.units.useQuery(
    { projectId },
    { ...authorizationQueryPolicy(viewAllowed) }
  );

  const [form, setForm] = useResourceDraftState(
    projectId,
    "project-authorization",
    "member",
    {
      userId: "",
      role: "viewer" as ProjectMemberRole,
      hours: "",
    }
  );
  const [memberSearch, setMemberSearch] = useResourceDraftState(
    projectId,
    "project-authorization",
    "memberSearch",
    "",
    false
  );
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState("");
  const [unitSearch, setUnitSearch] = useResourceDraftState(
    projectId,
    "project-authorization",
    "unitSearch",
    "",
    false
  );
  const [debouncedUnitSearch, setDebouncedUnitSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedMemberSearch(memberSearch.trim()),
      250
    );
    return () => window.clearTimeout(timer);
  }, [memberSearch]);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedUnitSearch(unitSearch.trim()),
      250
    );
    return () => window.clearTimeout(timer);
  }, [unitSearch]);
  const activeUsers = trpc.project.searchActiveUsers.useQuery(
    { projectId, query: debouncedMemberSearch },
    {
      enabled: canManage && debouncedMemberSearch.length > 0,
    }
  );
  const activeUnits = trpc.project.searchActiveUnits.useQuery(
    { projectId, query: debouncedUnitSearch },
    {
      enabled: canManage && debouncedUnitSearch.length > 0,
    }
  );
  const [unitForm, setUnitForm] = useResourceDraftState(
    projectId,
    "project-authorization",
    "unit",
    {
      unitId: "",
      role: "viewer" as ProjectMemberRole,
    }
  );
  type PickedOption = { value: string; label: string; keywords?: string };
  const [memberSelection, setMemberSelection] = useResourceDraftState<
    PickedOption[]
  >(projectId, "project-authorization", "memberSelection", [], false);
  const [unitSelection, setUnitSelection] = useResourceDraftState<
    PickedOption[]
  >(projectId, "project-authorization", "unitSelection", [], false);
  const [memberOpen, setMemberOpen] = useResourceDraftState(
    projectId,
    "project-authorization",
    "memberOpen",
    false,
    false
  );
  const [unitOpen, setUnitOpen] = useResourceDraftState(
    projectId,
    "project-authorization",
    "unitOpen",
    false,
    false
  );
  const [failure, setFailure] = useResourceDraftState(
    projectId,
    "project-authorization",
    "failure",
    "",
    false
  );
  const beginPending = useResourceDraftPending(
    projectId,
    "project-authorization"
  );
  const sessionPending = useResourceDraftSummary(projectId).pending;
  const submitting = useRef(false);
  const memberDirty = Boolean(
    form.userId || form.hours || form.role !== "viewer"
  );
  const unitDirty = Boolean(unitForm.unitId || unitForm.role !== "viewer");
  const memberOptions = Array.from(
    new Map(
      [
        ...memberSelection,
        ...(activeUsers.data?.items ?? []).map((user: any) => ({
          value: String(user.id),
          label: user.name || user.username,
          keywords: user.username,
        })),
      ].map(option => [option.value, option])
    ).values()
  );
  const unitOptions = Array.from(
    new Map(
      [
        ...unitSelection,
        ...(activeUnits.data?.items ?? []).map((unit: any) => ({
          value: String(unit.id),
          label: unit.displayPath || `${unit.name}（${unit.code}）`,
          keywords: `${unit.name} ${unit.code} ${unit.pathName ?? ""} ${unit.pathCode ?? ""}`,
        })),
      ].map(option => [option.value, option])
    ).values()
  );
  const failed = (error: {
    message: string;
    data?: { code?: string } | null;
  }) => {
    setFailure(
      error.data?.code && error.data.code !== "INTERNAL_SERVER_ERROR"
        ? error.message
        : "暂时无法确认保存结果，填写已保留。请先重新读取授权列表核对，再决定是否重试。"
    );
    void utils.project.access.invalidate({ projectId });
    toast.error("授权操作未确认，请查看提示并核对列表。");
  };
  const submit = async (action: () => Promise<unknown>) => {
    if (submitting.current || !canManage) return;
    submitting.current = true;
    const finish = beginPending();
    setFailure("");
    try {
      await action();
    } catch {
      /* Mutation errors retain the form and show recovery instructions. */
    } finally {
      submitting.current = false;
      finish();
    }
  };
  const [permissionRevocation, setPermissionRevocation] = useState<
    | {
        kind: "member";
        userId: number;
        assignmentId: string;
        roleLabel: string;
        displayName: string;
        username: string;
      }
    | { kind: "unit"; unitId: string; displayName: string; unitCode: string }
    | null
  >(null);

  const expiryError = roleExpiryInput(form.hours).error;

  const refreshProjectAuthorization = () =>
    Promise.all([
      utils.project.invalidate(),
      utils.workflow.access.invalidate(),
      utils.workflow.list.invalidate(),
      utils.workflow.page.invalidate(),
      utils.workflow.get.invalidate(),
    ]);
  const refreshAfterSave = () => {
    void refreshProjectAuthorization().catch(() =>
      setFailure("授权已提交成功，列表暂时未能刷新。请重新读取业务授权。")
    );
  };
  const grant = trpc.project.grantMember.useMutation({
    onSuccess: () => {
      setForm({ userId: "", role: "viewer", hours: "" });
      setMemberSearch("");
      setMemberSelection([]);
      refreshAfterSave();
      toast.success("成员角色授权已保存。");
    },
    onError: failed,
  });

  const revokeMember = trpc.project.revokeMember.useMutation({
    onSuccess: () => {
      setPermissionRevocation(null);
      refreshAfterSave();
      toast.success("所选成员角色授权已移除。");
    },
    onError: error => {
      void utils.project.members.invalidate({ projectId });
      void utils.project.access.invalidate({ projectId });
      failed(error);
    },
  });

  const grantUnit = trpc.project.grantUnit.useMutation({
    onSuccess: () => {
      setUnitForm({ unitId: "", role: "viewer" });
      setUnitSearch("");
      setUnitSelection([]);
      refreshAfterSave();
      toast.success("可见部门授权已保存。");
    },
    onError: failed,
  });

  const revokeUnit = trpc.project.revokeUnit.useMutation({
    onSuccess: () => {
      setPermissionRevocation(null);
      refreshAfterSave();
      toast.success("可见部门已移除。");
    },
    onError: failed,
  });
  const busy = Boolean(
    sessionPending ||
      grant.isPending ||
      grantUnit.isPending ||
      revokeMember.isPending ||
      revokeUnit.isPending
  );
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (busy || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([onRefreshAccess(), projectUnits.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };
  const discard = () => {
    if (busy) return;
    setForm({ userId: "", role: "viewer", hours: "" });
    setUnitForm({ unitId: "", role: "viewer" });
    setMemberSearch("");
    setUnitSearch("");
    setMemberSelection([]);
    setUnitSelection([]);
    setFailure("");
  };

  return (
    <div data-project-authorizations="" aria-busy={busy} className="space-y-6">
      <div className="border-b border-border pb-4">
        <p className="aiflow-type-meta font-bold tracking-[.16em] text-muted-foreground">
          人员与权限
        </p>
        <h1 className="aiflow-type-page-title mt-1 font-semibold text-foreground">
          业务成员与部门授权
        </h1>
        <p className="aiflow-type-body mt-1 text-muted-foreground">
          创建人保留所有权；可按人员或部门授予查看、运行或设计角色。业务管理员可管理本业务，不会获得系统管理员权限。
          多项有效授权共同生效；移除仅影响选中的角色授权，其他角色和部门继承仍保留。
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="aiflow-type-meta text-muted-foreground">
            {busy
              ? "正在提交授权，请等待完成。"
              : memberDirty || unitDirty
                ? "本次授权填写尚未保存，离开前会提示确认。"
                : "填写人员或部门后选择角色；授权记录每 30 秒更新。"}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy || refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "正在重新读取…" : "重新读取业务授权"}
          </Button>
          {(memberDirty || unitDirty) && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={busy}
              onClick={discard}
            >
              放弃本次授权填写
            </Button>
          )}
        </div>
        {failure && (
          <p
            role="alert"
            className="aiflow-type-body mt-3 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface p-3 text-foreground"
          >
            {failure}
          </p>
        )}
        {!canManage && (memberDirty || unitDirty) && (
          <p
            role="status"
            className="aiflow-type-body mt-3 rounded-lg border border-border bg-muted p-3"
          >
            管理权限暂不可用，已保留本次填写。恢复授权后可重新读取并继续保存。
          </p>
        )}
      </div>

      {/* 可见部门授权管理 */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-2xs">
        <div className="aiflow-type-body flex flex-col gap-1 border-b border-border bg-muted/70 px-4 py-3 font-semibold sm:flex-row sm:items-center sm:justify-between">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Building2 size={16} className="text-aiflow-info" />
            <span>可见部门列表（部门继承授权）</span>
            <span className="aiflow-type-meta rounded-full bg-card px-2 py-0.5 font-normal text-muted-foreground">
              {projectUnits.isPending
                ? "读取中"
                : projectUnits.isError
                  ? "读取失败"
                  : `${(projectUnits.data ?? []).length} 个部门`}
            </span>
          </span>
          <span className="aiflow-type-body leading-5 font-normal text-muted-foreground">
            启用部门中的成员继承此处选择的角色
          </span>
        </div>
        {(canManage || unitDirty) && (
          <details
            data-project-permission-grant="department"
            open={unitOpen}
            onToggle={event => setUnitOpen(event.currentTarget.open)}
            className="group border-b border-border"
          >
            <summary
              aria-disabled={busy}
              onClick={event => {
                if (busy) event.preventDefault();
              }}
              className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 font-medium text-aiflow-info marker:content-none hover:bg-aiflow-info-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden"
            >
              <span>添加部门授权</span>
              <ChevronDown
                size={16}
                aria-hidden="true"
                className="shrink-0 transition-transform group-open:rotate-180"
              />
            </summary>
            <form
              onSubmit={event => {
                event.preventDefault();
                if (
                  unitForm.unitId &&
                  canManage &&
                  !projectUnits.isError &&
                  !projectUnits.isPending
                ) {
                  void submit(() =>
                    grantUnit.mutateAsync({
                      projectId,
                      unitId: unitForm.unitId,
                      role: unitForm.role,
                    })
                  );
                }
              }}
            >
              <fieldset
                disabled={busy || !canManage}
                className="grid min-w-0 gap-3 border-t border-border bg-muted p-4 sm:grid-cols-2"
              >
                <div className="grid min-w-0 gap-1.5">
                  <p className="aiflow-type-meta text-muted-foreground">
                    授权部门
                  </p>
                  <SearchableMultiSelect
                    ariaLabel="选择可见部门"
                    value={unitForm.unitId ? [unitForm.unitId] : []}
                    options={unitOptions}
                    disabled={busy || !canManage}
                    query={unitSearch}
                    onQueryChange={setUnitSearch}
                    onChange={values => {
                      setUnitForm(previous => ({
                        ...previous,
                        unitId: values[0] ?? "",
                      }));
                      setUnitSelection(
                        unitOptions.filter(option =>
                          values.includes(option.value)
                        )
                      );
                    }}
                    placeholder="选择组织部门"
                    searchPlaceholder="搜索部门名称、路径或代号"
                    startSearchMessage="输入部门名称、路径或代号开始搜索。"
                    emptyMessage="没有可用部门，请检查组织架构配置。"
                    noResultsMessage="没有匹配的启用部门，请更换搜索词。"
                    loading={
                      unitSearch.trim() !== debouncedUnitSearch ||
                      activeUnits.isFetching
                    }
                    error={
                      unitSearch.trim() === debouncedUnitSearch &&
                      activeUnits.isError
                    }
                    hasMore={activeUnits.data?.hasMore ?? false}
                    requireSearch
                    maxSelected={1}
                  />
                  {unitSearch.trim() === debouncedUnitSearch &&
                    activeUnits.isError && (
                      <DirectoryRetry
                        name="部门"
                        onRetry={() => void activeUnits.refetch()}
                      />
                    )}
                </div>
                <label className="grid min-w-0 content-start gap-1.5">
                  <span className="aiflow-type-meta text-muted-foreground">
                    授予的角色
                  </span>
                  <select
                    aria-label="部门权限角色"
                    className="h-11 min-w-0 rounded border border-border bg-card px-2 text-sm text-foreground"
                    value={unitForm.role}
                    onChange={event =>
                      setUnitForm({
                        ...unitForm,
                        role: event.target.value as ProjectMemberRole,
                      })
                    }
                  >
                    <option value="viewer">查看者（仅查看）</option>
                    <option value="operator">运行者（可发起/运行）</option>
                    <option value="designer">设计者（可编辑流）</option>
                  </select>
                </label>
                <Button
                  type="submit"
                  className="min-h-11 sm:col-span-2 sm:justify-self-end"
                  disabled={
                    busy ||
                    !canManage ||
                    projectUnits.isError ||
                    projectUnits.isPending ||
                    !unitForm.unitId
                  }
                >
                  <Building2 size={15} />
                  {grantUnit.isPending ? "正在保存…" : "保存部门授权"}
                </Button>
                <p className="aiflow-type-meta text-muted-foreground sm:col-span-2">
                  同一部门只保留一个业务角色；再次保存会更新该部门的角色，其当前成员共同继承。
                </p>
              </fieldset>
            </form>
          </details>
        )}
        <div
          data-project-permission-list="department"
          className="divide-y divide-border"
        >
          <PermissionListFeedback
            name="部门授权"
            loading={projectUnits.isPending}
            error={projectUnits.isError}
            onRetry={() => void projectUnits.refetch()}
          />
          {viewAllowed &&
            !projectUnits.isError &&
            !projectUnits.isPending &&
            (projectUnits.data ?? []).map((item: any) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="aiflow-type-body font-medium text-foreground">
                    {item.unitName || item.unitCode}
                  </p>
                  <p className="aiflow-type-meta mt-0.5 font-mono text-muted-foreground">
                    部门代号：{item.unitCode} · 授权时间：
                    {formatDate(item.createdAt)}
                  </p>
                  {item.unitStatus === "disabled" && (
                    <p className="aiflow-type-meta mt-1 text-aiflow-warning">
                      部门已停用，当前不继承此授权。
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="aiflow-type-meta rounded bg-aiflow-special-surface px-2 py-1 font-medium text-aiflow-special">
                    {projectRoleLabel(item.role)}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`移除部门授权：${item.unitName || item.unitCode}（${item.unitCode}）`}
                      className="aiflow-type-control inline-flex min-h-11 items-center gap-1.5 rounded px-2.5 font-medium text-aiflow-danger hover:bg-aiflow-danger-surface hover:text-aiflow-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 min-[1280px]:min-h-9"
                      onClick={() =>
                        setPermissionRevocation({
                          kind: "unit",
                          unitId: item.unitId,
                          displayName: item.unitName || item.unitCode,
                          unitCode: item.unitCode,
                        })
                      }
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      移除部门
                    </button>
                  )}
                </div>
              </div>
            ))}
          {!projectUnits.isPending &&
            !projectUnits.isError &&
            !(projectUnits.data ?? []).length && (
              <p className="aiflow-type-body p-6 text-center text-muted-foreground">
                尚未绑定可见部门，外部部门员工无法继承访问。
              </p>
            )}
        </div>
      </section>

      {/* 可见人授权管理 */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-2xs">
        <div className="aiflow-type-body flex flex-col gap-1 border-b border-border bg-muted/70 px-4 py-3 font-semibold sm:flex-row sm:items-center sm:justify-between">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <UsersRound size={16} className="text-aiflow-info" />
            <span>可见人列表（成员直接授权）</span>
            <span className="aiflow-type-meta rounded-full bg-card px-2 py-0.5 font-normal text-muted-foreground">
              {membersLoading
                ? "读取中"
                : membersError
                  ? "读取失败"
                  : `${new Set(members.map(member => member.userId)).size} 位成员`}
            </span>
          </span>
          <span className="aiflow-type-body leading-5 font-normal text-muted-foreground">
            单独授权人员清单
          </span>
        </div>
        {(canManage || memberDirty) && (
          <details
            data-project-permission-grant="member"
            open={memberOpen}
            onToggle={event => setMemberOpen(event.currentTarget.open)}
            className="group border-b border-border"
          >
            <summary
              aria-disabled={busy}
              onClick={event => {
                if (busy) event.preventDefault();
              }}
              className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 font-medium text-aiflow-info marker:content-none hover:bg-aiflow-info-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden"
            >
              <span>添加成员授权</span>
              <ChevronDown
                size={16}
                aria-hidden="true"
                className="shrink-0 transition-transform group-open:rotate-180"
              />
            </summary>
            <form
              onSubmit={event => {
                event.preventDefault();
                const expiry = roleExpiryInput(form.hours);
                if (expiry.error) {
                  toast.error(expiry.error);
                  return;
                }
                const userId = Number(form.userId);
                if (userId && canManage && !membersError && !membersLoading) {
                  void submit(() =>
                    grant.mutateAsync({
                      projectId,
                      userId,
                      role: form.role,
                      expiresAt: expiry.expiresAt,
                    })
                  );
                }
              }}
            >
              <fieldset
                disabled={busy || !canManage}
                className="grid min-w-0 gap-3 border-t border-border bg-muted p-4 sm:grid-cols-2"
              >
                <div className="grid min-w-0 gap-1.5">
                  <p className="aiflow-type-meta text-muted-foreground">
                    授权人员
                  </p>
                  <SearchableMultiSelect
                    ariaLabel="选择可见人账号"
                    value={form.userId ? [form.userId] : []}
                    options={memberOptions}
                    disabled={busy || !canManage}
                    query={memberSearch}
                    onQueryChange={setMemberSearch}
                    onChange={values => {
                      setForm(previous => ({
                        ...previous,
                        userId: values[0] ?? "",
                      }));
                      setMemberSelection(
                        memberOptions.filter(option =>
                          values.includes(option.value)
                        )
                      );
                    }}
                    placeholder="选择项目成员"
                    searchPlaceholder="搜索姓名或账号"
                    startSearchMessage="输入姓名或账号开始搜索。"
                    emptyMessage="没有可授权的有效账号。"
                    noResultsMessage="没有匹配成员，请更换姓名或账号。"
                    loading={
                      memberSearch.trim() !== debouncedMemberSearch ||
                      activeUsers.isFetching
                    }
                    error={
                      memberSearch.trim() === debouncedMemberSearch &&
                      activeUsers.isError
                    }
                    hasMore={activeUsers.data?.hasMore ?? false}
                    requireSearch
                    maxSelected={1}
                  />
                  {memberSearch.trim() === debouncedMemberSearch &&
                    activeUsers.isError && (
                      <DirectoryRetry
                        name="人员"
                        onRetry={() => void activeUsers.refetch()}
                      />
                    )}
                </div>
                <label className="grid min-w-0 content-start gap-1.5">
                  <span className="aiflow-type-meta text-muted-foreground">
                    授予的角色
                  </span>
                  <select
                    aria-label="用户权限角色"
                    className="h-11 min-w-0 rounded border border-border bg-card px-2 text-sm text-foreground"
                    value={form.role}
                    onChange={event =>
                      setForm({
                        ...form,
                        role: event.target.value as ProjectMemberRole,
                      })
                    }
                  >
                    <option value="viewer">查看者</option>
                    <option value="operator">运行者</option>
                    <option value="designer">设计者</option>
                    <option value="owner">业务管理员</option>
                  </select>
                </label>
                <div className="grid min-w-0 gap-1.5 sm:col-span-2 sm:max-w-sm">
                  <label
                    htmlFor={`project-member-expiry-${projectId}`}
                    className="aiflow-type-meta text-muted-foreground"
                  >
                    有效期（小时，可选）
                  </label>
                  <Input
                    id={`project-member-expiry-${projectId}`}
                    aria-label="有效期小时（可选）"
                    className="h-11 bg-card"
                    type="number"
                    min="1"
                    step="1"
                    aria-invalid={Boolean(expiryError)}
                    aria-describedby="project-member-expiry-help"
                    placeholder="有效期小时（可选）"
                    value={form.hours}
                    onChange={event =>
                      setForm({ ...form, hours: event.target.value })
                    }
                  />
                  <p
                    id="project-member-expiry-help"
                    className="text-sm text-muted-foreground"
                    role={expiryError ? "alert" : undefined}
                  >
                    {expiryError || "填写整数小时；留空表示长期有效。"}
                  </p>
                </div>
                <Button
                  type="submit"
                  className="min-h-11 sm:col-span-2 sm:justify-self-end"
                  disabled={
                    busy ||
                    !canManage ||
                    membersError ||
                    membersLoading ||
                    !form.userId ||
                    Boolean(expiryError)
                  }
                >
                  <UsersRound size={15} />
                  {grant.isPending ? "正在保存…" : "保存成员授权"}
                </Button>
              </fieldset>
            </form>
          </details>
        )}
        <div
          data-project-permission-list="member"
          className="divide-y divide-border"
        >
          <PermissionListFeedback
            name="成员授权"
            loading={membersLoading}
            error={membersError}
            onRetry={onRetryMembers}
          />
          {viewAllowed &&
            !membersError &&
            !membersLoading &&
            members.map(member => (
              <div
                key={member.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="aiflow-type-body font-medium text-foreground">
                    {member.name || member.username}
                  </p>
                  <p className="aiflow-type-meta mt-0.5 text-muted-foreground">
                    {member.username} · 生效：{formatDate(member.effectiveFrom)}{" "}
                    · 到期：
                    {member.expiresAt ? formatDate(member.expiresAt) : "长期"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="aiflow-type-meta rounded bg-accent px-2 py-1 font-medium text-aiflow-info">
                    {member.protectedOwner
                      ? "创建人"
                      : projectRoleLabel(member.role)}
                  </span>
                  {canManage && canRevokeProjectGrant(member) && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`移除成员授权：${member.name || member.username}（${member.username}） · ${projectRoleLabel(member.role)}`}
                      className="aiflow-type-control inline-flex min-h-11 items-center gap-1.5 rounded px-2.5 font-medium text-aiflow-danger hover:bg-aiflow-danger-surface hover:text-aiflow-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 min-[1280px]:min-h-9"
                      onClick={() =>
                        setPermissionRevocation({
                          kind: "member",
                          userId: member.userId,
                          assignmentId: member.id,
                          roleLabel: projectRoleLabel(member.role),
                          displayName: member.name || member.username,
                          username: member.username,
                        })
                      }
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      移除
                    </button>
                  )}
                </div>
              </div>
            ))}
          {!membersLoading && !membersError && !members.length && (
            <p className="aiflow-type-body p-6 text-center text-muted-foreground">
              项目尚无单独可见人员。
            </p>
          )}
        </div>
      </section>
      <AlertDialog
        open={Boolean(permissionRevocation) && viewAllowed}
        onOpenChange={open => {
          if (!open && !busy) {
            setPermissionRevocation(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除项目授权</AlertDialogTitle>
            <AlertDialogDescription className="aiflow-type-body leading-6">
              {permissionRevocation?.kind === "member"
                ? `将移除“${permissionRevocation.displayName}”（${permissionRevocation.username}）的“${permissionRevocation.roleLabel}”角色授权。其他角色和部门继承授权不受影响。`
                : permissionRevocation?.kind === "unit"
                  ? `将移除“${permissionRevocation.displayName}”（${permissionRevocation.unitCode}）对此项目的部门授权。成员若仍有直接授权或其他部门授权，项目访问可能继续有效。`
                  : "请确认要移除所选项目授权。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failure && (
            <p role="alert" className="aiflow-type-body text-destructive">
              {failure}
            </p>
          )}
          {!canManage && (
            <p role="alert" className="aiflow-type-body text-destructive">
              管理权限暂不可用，不能提交移除。可取消后重新读取业务权限。
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy}
              className="aiflow-type-control h-11 min-h-11"
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !canManage}
              className="aiflow-type-control h-11 min-h-11 bg-rose-600 text-white hover:bg-rose-700"
              onClick={event => {
                event.preventDefault();
                if (busy || !canManage) return;
                const selected = permissionRevocation;
                if (selected?.kind === "member") {
                  void submit(() =>
                    revokeMember.mutateAsync({
                      projectId,
                      userId: selected.userId,
                      assignmentId: selected.assignmentId,
                    })
                  );
                } else if (selected?.kind === "unit") {
                  void submit(() =>
                    revokeUnit.mutateAsync({
                      projectId,
                      unitId: selected.unitId,
                    })
                  );
                }
              }}
            >
              {revokeMember.isPending || revokeUnit.isPending
                ? "正在移除…"
                : "确认移除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
