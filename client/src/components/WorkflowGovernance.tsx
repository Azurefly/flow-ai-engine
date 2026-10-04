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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { normalizeWorkflowRunSearchQuery } from "@shared/workflow-run-search";
import { runDetailRefreshInterval } from "@shared/run-detail-refresh";
import {
  GitCompareArrows,
  History,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RunDetailDialog } from "./WorkflowGovernanceRunDetail";

export type WorkflowGovernanceSection = "overview" | "runs" | "versions";

function formatTime(value: unknown) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString("zh-CN", { hour12: false });
}

const runStatusPresentation: Record<
  string,
  { label: string; className: string }
> = {
  queued: { label: "排队中", className: "bg-muted text-foreground" },
  running: {
    label: "运行中",
    className: "bg-aiflow-info-surface text-aiflow-info",
  },
  waiting: {
    label: "等待中",
    className: "bg-aiflow-warning-surface text-aiflow-warning",
  },
  blocked: { label: "已阻塞", className: "bg-orange-100 text-orange-700" },
  success: {
    label: "成功",
    className: "bg-aiflow-success-surface text-aiflow-success",
  },
  failed: { label: "失败", className: "bg-red-100 text-red-700" },
  cancelled: { label: "已取消", className: "bg-muted text-muted-foreground" },
  terminated: { label: "已终止", className: "bg-muted text-muted-foreground" },
};

function getRunStatusPresentation(status: string) {
  return (
    runStatusPresentation[status] ?? {
      label: status ? `未知状态（原值：${status}）` : "未知状态",
      className: "bg-muted text-muted-foreground",
    }
  );
}

export default function WorkflowGovernance({
  workflowId,
  canEdit,
  canPublish,
  activeSection = "overview",
  canvas,
}: {
  workflowId: string;
  canEdit: boolean;
  canPublish: boolean;
  activeSection?: WorkflowGovernanceSection;
  canvas?: ReactNode;
}) {
  const utils = trpc.useUtils();
  const versions = trpc.workflow.versions.useQuery(
    { workflowId },
    { enabled: activeSection === "versions", retry: false }
  );
  const workflow = trpc.workflow.get.useQuery(
    { id: workflowId },
    { retry: false }
  );
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [toVersion, setToVersion] = useState<number | null>(null);
  const [runKeyword, setRunKeyword] = useState("");
  const [runSearchQuery, setRunSearchQuery] = useState("");
  const [runHistoryNavigation, setRunHistoryNavigation] = useState<{
    filterKey: string;
    cursors: Array<string | undefined>;
  }>({ filterKey: "", cursors: [undefined] });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoName, setInfoName] = useState("");
  const [infoDescription, setInfoDescription] = useState("");
  const item = workflow.data as any;
  const runHistoryFilterKey = JSON.stringify([workflowId, runSearchQuery]);
  const runHistoryCursorStack =
    runHistoryNavigation.filterKey === runHistoryFilterKey
      ? runHistoryNavigation.cursors
      : [undefined];
  const runs = trpc.workflow.runHistoryPage.useQuery(
    {
      workflowId,
      searchQuery: runSearchQuery || undefined,
      cursor: runHistoryCursorStack.at(-1),
      pageSize: 25,
    },
    { enabled: activeSection === "runs", retry: false }
  );
  const selectedRun = trpc.workflow.runDetail.useQuery(
    { runId: selectedRunId ?? "00000000" },
    {
      enabled: Boolean(selectedRunId) && activeSection === "runs",
      retry: false,
      refetchInterval: query =>
        runDetailRefreshInterval(
          query.state.data?.status,
          Boolean(query.state.error)
        ),
      refetchIntervalInBackground: false,
    }
  );
  const versionItems = (versions.data ?? []) as any[];

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setRunSearchQuery(normalizeWorkflowRunSearchQuery(runKeyword)),
      250
    );
    return () => window.clearTimeout(timeout);
  }, [runKeyword]);

  useEffect(() => {
    setFromVersion(null);
    setToVersion(null);
    setRunKeyword("");
    setRunSearchQuery("");
    setSelectedRunId(null);
    setEditingInfo(false);
  }, [workflowId]);

  useEffect(() => {
    if (!versionItems.length) return;
    setToVersion(current => current ?? Number(versionItems[0].version));
    setFromVersion(
      current =>
        current ?? Number(versionItems[1]?.version ?? versionItems[0].version)
    );
  }, [versionItems]);

  useEffect(() => {
    if (activeSection !== "runs") setSelectedRunId(null);
    if (activeSection !== "overview") setEditingInfo(false);
  }, [activeSection]);

  const diffInput = useMemo(
    () => ({
      workflowId,
      fromVersion: fromVersion ?? 1,
      toVersion: toVersion ?? 1,
    }),
    [fromVersion, toVersion, workflowId]
  );
  const diff = trpc.workflow.versionDiff.useQuery(diffInput, {
    enabled:
      activeSection === "versions" &&
      Boolean(fromVersion && toVersion && fromVersion !== toVersion),
    retry: false,
  });
  const rollback = trpc.workflow.rollbackVersion.useMutation({
    onSuccess: () => {
      void utils.workflow.list.invalidate();
      void utils.workflow.versions.invalidate({ workflowId });
      void utils.workflow.versionDiff.invalidate();
      toast.success("已恢复目标版本，并生成新的可审计快照。");
    },
    onError: error => toast.error(error.message),
  });

  const projectAccess = trpc.project.access.useQuery(
    { projectId: item?.projectId ?? "00000000" },
    {
      enabled: Boolean(item?.projectId) && activeSection === "overview",
      retry: false,
    }
  );
  const canEditInfo = Boolean(
    projectAccess.data?.permissions?.has("project:workflow:edit")
  );
  const updateInfo = trpc.project.updateWorkflowInfo.useMutation({
    onSuccess: () => {
      if (item?.projectId) {
        void utils.project.workflows.invalidate({ projectId: item.projectId });
        void utils.project.access.invalidate({ projectId: item.projectId });
      }
      void utils.workflow.get.invalidate({ id: workflowId });
      void utils.workflow.list.invalidate();
      setEditingInfo(false);
      toast.success("流程基本信息已更新，并已写入项目审计。");
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!item || editingInfo) return;
    setInfoName(String(item.name ?? ""));
    setInfoDescription(String(item.description ?? ""));
  }, [editingInfo, item?.description, item?.name]);

  const visibleRuns = runs.data?.items ?? [];

  return (
    <div className="min-w-0">
      {activeSection === "overview" && (
        <section
          data-aiflow-process-detail=""
          className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          {workflow.isError ? (
            <div className="p-6 text-center" role="alert">
              <p className="text-sm font-medium text-foreground">
                流程详情加载失败
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void workflow.refetch()}
              >
                重试
              </Button>
            </div>
          ) : (
            <>
              <div className="p-3 sm:p-4">
                {canvas ?? (
                  <div className="rounded-lg border border-border bg-muted p-5 text-sm text-muted-foreground">
                    流程图只读预览
                  </div>
                )}
              </div>

              <div className="border-t border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <h2 className="aiflow-type-section-title font-semibold text-foreground">
                      基本信息
                    </h2>
                    <p className="aiflow-type-body mt-0.5 text-muted-foreground">
                      流程说明和创建、发布记录
                    </p>
                  </div>
                  {canEditInfo && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setEditingInfo(true)}
                    >
                      编辑基本信息
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
                  <InfoField
                    label="流程名称"
                    value={
                      item?.name ?? (workflow.isLoading ? "正在读取…" : "—")
                    }
                  />
                  <InfoField
                    label="流程说明"
                    value={item?.description || "未填写流程说明"}
                  />
                </div>
                <WorkflowTimeAudit
                  createdAt={item?.createdAt}
                  publishedAt={item?.publishedAt}
                  unpublishedAt={item?.unpublishedAt}
                />
                <AuditResetButton
                  projectId={item?.projectId}
                  workflowId={workflowId}
                  auditStatus={item?.auditStatus}
                  status={item?.status}
                />
              </div>
            </>
          )}
        </section>
      )}

      {activeSection === "runs" && (
        <section
          data-aiflow-process-runs=""
          className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                运行记录
              </h2>
              <p className="aiflow-type-body mt-1 text-muted-foreground">
                搜索覆盖当前流程全部运行记录 · 每页最多 25 条
              </p>
            </div>
            <label className="relative block w-full sm:max-w-xs">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-2.5 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="搜索运行编号、发起人或状态"
                className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                value={runKeyword}
                onChange={event => setRunKeyword(event.target.value)}
                placeholder="搜索编号、发起人或状态"
              />
            </label>
          </div>
          {runs.isError ? (
            <div
              role="alert"
              className="grid justify-items-center gap-3 px-4 py-10 text-center"
            >
              <p className="text-sm text-aiflow-danger">运行记录加载失败</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => void runs.refetch()}
              >
                重试
              </Button>
            </div>
          ) : runs.isLoading ? (
            <div
              role="status"
              className="flex min-h-28 items-center justify-center px-4 py-10"
            >
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                正在读取运行记录…
              </span>
            </div>
          ) : visibleRuns.length ? (
            <>
              <div
                data-aiflow-process-run-cards=""
                className="grid gap-2 p-3 md:hidden"
              >
                {visibleRuns.map(run => {
                  const status = String(run.status ?? "");
                  const presentation = getRunStatusPresentation(status);
                  const runId = String(run.id);
                  return (
                    <article
                      key={run.id}
                      className="min-w-0 rounded-md border border-border p-3"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <code
                          className="aiflow-type-body min-w-0 truncate font-mono font-semibold text-foreground"
                          title={runId}
                        >
                          {runId.slice(0, 8)}
                        </code>
                        <span
                          className={`aiflow-type-meta shrink-0 rounded-full px-2 py-1 font-medium ${presentation.className}`}
                        >
                          {presentation.label}
                        </span>
                      </div>
                      <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">
                        <div className="min-w-0">
                          <dt className="aiflow-type-meta text-muted-foreground">
                            发起人
                          </dt>
                          <dd className="aiflow-type-body mt-0.5 break-words text-foreground">
                            {run.triggeredByName || run.username || "—"}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="aiflow-type-meta text-muted-foreground">
                            开始时间
                          </dt>
                          <dd className="aiflow-type-meta mt-0.5 break-words tabular-nums text-foreground">
                            {formatTime(run.startedAt ?? run.createdAt)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="aiflow-type-meta text-muted-foreground">
                            结束时间
                          </dt>
                          <dd className="aiflow-type-meta mt-0.5 break-words tabular-nums text-foreground">
                            {formatTime(run.finishedAt)}
                          </dd>
                        </div>
                      </dl>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="aiflow-type-control mt-3 h-11 min-h-11 w-full justify-center"
                        aria-label={`查看运行 ${runId} 实例详情`}
                        onClick={() => setSelectedRunId(runId)}
                      >
                        实例详情
                      </Button>
                    </article>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-muted text-sm text-muted-foreground">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3 font-medium">
                        运行编号
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 font-medium">
                        发起人
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 font-medium">
                        开始时间
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 font-medium">
                        结束时间
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 font-medium">
                        状态
                      </th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRuns.map(run => {
                      const status = String(run.status ?? "");
                      const presentation = getRunStatusPresentation(status);
                      const runId = String(run.id);
                      return (
                        <tr key={run.id} className="border-t border-border">
                          <td
                            className="aiflow-type-code whitespace-nowrap px-4 py-3 font-mono text-muted-foreground"
                            title={runId}
                          >
                            {runId.slice(0, 8)}
                          </td>
                          <td className="max-w-48 truncate px-4 py-3 text-foreground">
                            {run.triggeredByName || run.username || "—"}
                          </td>
                          <td className="aiflow-type-meta whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {formatTime(run.startedAt ?? run.createdAt)}
                          </td>
                          <td className="aiflow-type-meta whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {formatTime(run.finishedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`aiflow-type-meta inline-flex rounded-full px-2 py-1 font-medium ${presentation.className}`}
                            >
                              {presentation.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="aiflow-type-control h-11 min-h-11 md:h-9 md:min-h-0"
                              aria-label={`查看运行 ${runId} 实例详情`}
                              onClick={() => setSelectedRunId(runId)}
                            >
                              实例详情
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {runSearchQuery
                ? "全部运行记录中没有匹配项。"
                : "该流程尚无运行记录。"}
            </div>
          )}
          <div className="aiflow-type-meta flex flex-col gap-2 border-t border-border px-4 py-3 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span aria-live="polite">
              第 {runHistoryCursorStack.length} 页 · 本页 {visibleRuns.length}{" "}
              条
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 flex-1 sm:h-9 sm:flex-none"
                disabled={runHistoryCursorStack.length <= 1 || runs.isFetching}
                onClick={() =>
                  setRunHistoryNavigation({
                    filterKey: runHistoryFilterKey,
                    cursors: runHistoryCursorStack.slice(0, -1),
                  })
                }
              >
                较新记录
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 flex-1 sm:h-9 sm:flex-none"
                disabled={!runs.data?.nextCursor || runs.isFetching}
                onClick={() => {
                  const nextCursor = runs.data?.nextCursor;
                  if (nextCursor)
                    setRunHistoryNavigation({
                      filterKey: runHistoryFilterKey,
                      cursors: [...runHistoryCursorStack, nextCursor],
                    });
                }}
              >
                更早记录
              </Button>
            </div>
          </div>
          {selectedRunId && (
            <RunDetailDialog
              run={selectedRun.data as any}
              onClose={() => setSelectedRunId(null)}
            />
          )}
        </section>
      )}

      {activeSection === "versions" && (
        <section
          data-aiflow-process-versions=""
          className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="aiflow-type-section-title flex items-center gap-2 font-semibold text-foreground">
                <History size={16} className="text-indigo-600" />
                版本历史
              </h2>
              <p className="aiflow-type-body mt-1 text-muted-foreground">
                查看快照差异；恢复操作会生成新的可审计版本。
              </p>
            </div>
            <span className="aiflow-type-meta inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              <ShieldCheck size={13} aria-hidden="true" />
              {canEdit ? "可恢复版本" : "只读版本历史"}
            </span>
          </div>
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
            <section aria-label="版本快照列表">
              <h3 className="aiflow-type-section-title mb-2 font-semibold text-foreground">
                版本快照
              </h3>
              <div className="max-h-[520px] overflow-y-auto rounded-md border border-border bg-muted p-2">
                {versions.isError ? (
                  <div className="p-4 text-center" role="alert">
                    <p className="aiflow-type-body text-aiflow-danger">
                      版本历史加载失败
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => void versions.refetch()}
                    >
                      重试
                    </Button>
                  </div>
                ) : versions.isLoading ? (
                  <p className="aiflow-type-body p-4 text-center text-muted-foreground">
                    正在读取版本快照…
                  </p>
                ) : versionItems.length ? (
                  versionItems.map((version: any) => (
                    <article
                      key={version.id}
                      className={`mb-2 rounded-md border p-3 last:mb-0 ${Number(version.version) === toVersion ? "border-indigo-200 bg-indigo-50" : "border-border bg-card"}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          className="font-mono text-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          onClick={() => setToVersion(Number(version.version))}
                        >
                          v{version.version}
                        </button>
                        <span className="aiflow-type-meta rounded bg-muted px-2 py-1 text-muted-foreground">
                          {version.changeSource}
                        </span>
                      </div>
                      <p className="mt-2 break-words text-sm font-medium text-foreground">
                        {version.name}
                      </p>
                      <p className="aiflow-type-meta mt-1 text-muted-foreground">
                        {formatTime(version.createdAt)} ·{" "}
                        {version.creatorName || version.username || "系统"}
                      </p>
                      {version.restoredFromVersion && (
                        <p className="aiflow-type-meta mt-1 text-aiflow-warning">
                          恢复自 v{version.restoredFromVersion}
                        </p>
                      )}
                      {canEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3 h-8 text-xs"
                          disabled={
                            rollback.isPending ||
                            (version.status === "published" && !canPublish)
                          }
                          onClick={() => {
                            if (
                              window.confirm(
                                `将流程恢复到 v${version.version} 吗？系统会新建一个可审计版本。`
                              )
                            ) {
                              rollback.mutate({
                                workflowId,
                                targetVersion: Number(version.version),
                              });
                            }
                          }}
                        >
                          {rollback.isPending ? (
                            <Loader2 className="animate-spin" size={13} />
                          ) : (
                            <RotateCcw size={13} />
                          )}
                          恢复此版本
                        </Button>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    当前流程尚未生成版本快照。
                  </p>
                )}
              </div>
            </section>

            <section
              aria-label="版本差异"
              className="min-w-0 rounded-md border border-border p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <GitCompareArrows
                  size={16}
                  className="text-indigo-600"
                  aria-hidden="true"
                />
                <h3 className="aiflow-type-section-title mr-auto font-semibold text-foreground">
                  版本差异
                </h3>
                <label className="aiflow-type-control flex items-center gap-2 text-muted-foreground">
                  <span>基准</span>
                  <select
                    aria-label="基准版本"
                    className="aiflow-type-control h-9 max-w-36 rounded border border-border bg-card px-2"
                    value={fromVersion ?? ""}
                    onChange={event =>
                      setFromVersion(Number(event.target.value))
                    }
                    disabled={!versionItems.length}
                  >
                    {versionItems.map((version: any) => (
                      <option
                        key={`from-${version.id}`}
                        value={version.version}
                      >
                        v{version.version}
                      </option>
                    ))}
                  </select>
                </label>
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
                <label className="aiflow-type-control flex items-center gap-2 text-muted-foreground">
                  <span>比较</span>
                  <select
                    aria-label="比较版本"
                    className="aiflow-type-control h-9 max-w-36 rounded border border-border bg-card px-2"
                    value={toVersion ?? ""}
                    onChange={event => setToVersion(Number(event.target.value))}
                    disabled={!versionItems.length}
                  >
                    {versionItems.map((version: any) => (
                      <option key={`to-${version.id}`} value={version.version}>
                        v{version.version}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {diff.isError ? (
                <div
                  className="mt-4 rounded-md bg-aiflow-danger-surface p-4 text-center"
                  role="alert"
                >
                  <p className="text-sm text-aiflow-danger">版本差异加载失败</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void diff.refetch()}
                  >
                    重试
                  </Button>
                </div>
              ) : diff.isLoading ? (
                <p className="mt-4 rounded-md bg-muted p-4 text-sm text-muted-foreground">
                  正在计算版本差异…
                </p>
              ) : diff.data ? (
                <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                  <DiffBlock
                    label="新增节点"
                    items={diff.data.addedNodes.map(
                      (node: any) => `${node.name} · ${node.type}`
                    )}
                    tone="emerald"
                  />
                  <DiffBlock
                    label="移除节点"
                    items={diff.data.removedNodes.map(
                      (node: any) => `${node.name} · ${node.type}`
                    )}
                    tone="red"
                  />
                  <DiffBlock
                    label="变更节点"
                    items={diff.data.changedNodes.map(
                      (node: any) =>
                        `${node.name}：${node.changedFields.join("、")}`
                    )}
                    tone="amber"
                  />
                  <DiffBlock
                    label="连线变化"
                    items={[
                      `新增 ${diff.data.addedEdges.length} 条`,
                      `移除 ${diff.data.removedEdges.length} 条`,
                    ]}
                    tone="slate"
                  />
                </div>
              ) : (
                <div className="mt-4 rounded-md bg-muted p-4 text-sm leading-6 text-muted-foreground">
                  {versionItems.length < 2
                    ? "至少需要两个版本快照才能比较。"
                    : fromVersion === toVersion
                      ? "请选择两个不同版本。"
                      : "选择两个版本后，将展示节点、配置与连线的结构化差异。"}
                </div>
              )}
            </section>
          </div>
        </section>
      )}

      {activeSection === "overview" && editingInfo && (
        <Dialog open={editingInfo} onOpenChange={setEditingInfo}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>编辑流程基本信息</DialogTitle>
              <DialogDescription>
                仅更新流程名称和说明，不会修改流程定义、审核状态、发布状态或运行记录。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <label className="aiflow-type-control grid gap-1.5 font-medium text-foreground">
                流程名称
                <Input
                  value={infoName}
                  maxLength={160}
                  onChange={event => setInfoName(event.target.value)}
                />
              </label>
              <label className="aiflow-type-control grid gap-1.5 font-medium text-foreground">
                流程说明
                <Textarea
                  value={infoDescription}
                  maxLength={1200}
                  rows={4}
                  onChange={event => setInfoDescription(event.target.value)}
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingInfo(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={
                  updateInfo.isPending || !infoName.trim() || !item?.projectId
                }
                onClick={() =>
                  updateInfo.mutate({
                    projectId: item.projectId,
                    workflowId,
                    name: infoName,
                    description: infoDescription || null,
                  })
                }
              >
                {updateInfo.isPending && (
                  <Loader2 className="animate-spin" size={14} />
                )}
                保存基本信息
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="aiflow-type-control font-medium text-muted-foreground">
        {label}
      </p>
      <p className="aiflow-type-body mt-1 break-words text-foreground">
        {value}
      </p>
    </div>
  );
}

function AuditResetButton({
  projectId,
  workflowId,
  auditStatus,
  status,
}: {
  projectId?: string | null;
  workflowId: string;
  auditStatus?: string;
  status?: string;
}) {
  const utils = trpc.useUtils();
  const access = trpc.project.access.useQuery(
    { projectId: projectId ?? "00000000" },
    { enabled: Boolean(projectId), retry: false }
  );
  const reset = trpc.project.resetWorkflowAudit.useMutation({
    onSuccess: () => {
      if (projectId) {
        void utils.project.workflows.invalidate({ projectId });
        void utils.project.access.invalidate({ projectId });
      }
      void utils.workflow.get.invalidate({ id: workflowId });
      void utils.workflow.versions.invalidate({ workflowId });
      toast.success("审核状态已重置为待审核草稿；定义和版本均已保留。");
    },
    onError: error => toast.error(error.message),
  });
  if (
    !projectId ||
    auditStatus !== "rejected" ||
    status !== "draft" ||
    !access.data?.permissions?.has("project:manage")
  ) {
    return null;
  }

  return (
    <div className="mx-4 mb-4 flex flex-col gap-2 rounded-md border border-aiflow-warning-border bg-aiflow-warning-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="aiflow-type-body text-amber-900">
        该流程已被驳回。重置后回到待审核草稿，不会自动发布或改变定义。
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-amber-300 text-amber-900 hover:bg-aiflow-warning-surface"
        disabled={reset.isPending}
        onClick={() => {
          if (window.confirm("确定重置审核状态吗？流程将恢复为待审核草稿。")) {
            reset.mutate({ projectId, workflowId });
          }
        }}
      >
        {reset.isPending && <Loader2 className="animate-spin" size={14} />}
        重置审核状态
      </Button>
    </div>
  );
}

function WorkflowTimeAudit({
  createdAt,
  publishedAt,
  unpublishedAt,
}: {
  createdAt?: unknown;
  publishedAt?: unknown;
  unpublishedAt?: unknown;
}) {
  return (
    <div className="grid gap-3 border-t border-border bg-muted/60 p-4 sm:grid-cols-3">
      <TimeAuditItem label="创建时间" value={createdAt} empty="正在读取…" />
      <TimeAuditItem
        label="最近发布时间"
        value={publishedAt}
        empty="尚未发布"
      />
      <TimeAuditItem
        label="最近取消发布时间"
        value={unpublishedAt}
        empty="尚未取消发布"
      />
    </div>
  );
}

function TimeAuditItem({
  label,
  value,
  empty,
}: {
  label: string;
  value?: unknown;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <p className="aiflow-type-meta font-medium text-muted-foreground">
        {label}
      </p>
      <p className="aiflow-type-meta mt-1 break-words text-foreground">
        {value ? formatTime(value) : empty}
      </p>
    </div>
  );
}

function DiffBlock({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "emerald" | "red" | "amber" | "slate";
}) {
  const classes = {
    emerald:
      "border-aiflow-success-border bg-aiflow-success-surface text-aiflow-success",
    red: "border-red-100 bg-red-50 text-red-800",
    amber:
      "border-aiflow-warning-border bg-aiflow-warning-surface text-aiflow-warning",
    slate: "border-border bg-muted text-foreground",
  };
  return (
    <div className={`min-w-0 rounded-md border p-3 ${classes[tone]}`}>
      <p className="aiflow-type-section-title font-semibold">{label}</p>
      <ul className="aiflow-type-body mt-2 grid gap-1">
        {items.length ? (
          items.map((item, index) => <li key={`${label}-${index}`}>{item}</li>)
        ) : (
          <li>无变化</li>
        )}
      </ul>
    </div>
  );
}
