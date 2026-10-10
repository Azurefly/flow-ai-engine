import {
  dataflowTerminalResults,
  dataflowResultColumns,
} from "@shared/dataflow-result-preview";
import {
  readRunInputRows,
  runInputRowsFromValue,
  type RunInputRow,
  type RunInputKind,
} from "@shared/run-input-editor";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  DraftSaveBeforeRunError,
  runAfterDraftSave,
} from "@shared/run-after-draft-save";
import { canStartActualWorkflowRun } from "@shared/actual-run-confirmation";
import { toast } from "sonner";
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Table as TableIcon,
  Code2,
  RefreshCw,
  SlidersHorizontal,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  Trash2,
  Plus,
  Compass,
  UserCheck,
  Clock,
  HelpCircle,
} from "lucide-react";

interface WorkflowTestRunModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: any;
  definition: any;
  runInput: Record<string, unknown>;
  onChangeRunInput: (input: Record<string, unknown>) => void;
  canRun: boolean;
  hasUnpublishedChanges?: boolean;
  onSaveDraft?: () => Promise<void>;
}

export default function WorkflowTestRunModal({
  open,
  onOpenChange,
  workflow,
  definition,
  runInput,
  onChangeRunInput,
  canRun,
  hasUnpublishedChanges = false,
  onSaveDraft,
}: WorkflowTestRunModalProps) {
  const isDataflow = workflow?.flowType === "data";
  const isStateflow = workflow?.flowType === "state";
  const dataProjectAccess = trpc.project.access.useQuery(
    { projectId: workflow?.projectId ?? "00000000" },
    { enabled: Boolean(open && isDataflow && workflow?.projectId), retry: false }
  );
  const requiredDataPermission = workflow?.status === "published" ? "project:workflow:run" : "project:workflow:edit";
  const canExecute = canRun && (!isDataflow || (!dataProjectAccess.isError && !dataProjectAccess.isFetching && Boolean(dataProjectAccess.data?.permissions.has(requiredDataPermission))));
  const executionPermissionHint = !canRun
    ? "当前账号没有运行权限"
    : isDataflow && !canExecute
      ? dataProjectAccess.isError ? "项目权限加载失败，请重试" : dataProjectAccess.isFetching ? "正在确认项目权限" : workflow?.status === "published" ? "当前账号没有项目流程运行权限" : "草稿测试需要项目流程编辑权限，请联系项目管理员"
      : undefined;
  const [activeTab, setActiveTab] = useState<"result" | "steps" | "input">(
    "result"
  );
  const [viewMode, setViewMode] = useState<"config" | "result">("config");
  const [resultDisplayMode, setResultDisplayMode] = useState<"table" | "json">(
    "table"
  );
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [acknowledgedActualRun, setAcknowledgedActualRun] = useState(false);
  const [outputPage, setOutputPage] = useState(1);
  const OUTPUT_PAGE_SIZE = 10;
  const [selectedTerminal, setSelectedTerminal] = useState(0);
  const [inputErrors, setInputErrors] = useState<string[]>([]);

  const canStartActualRun =
    canStartActualWorkflowRun({
      canRun: canExecute,
      isRunning,
      acknowledged: acknowledgedActualRun,
    }) && inputErrors.length === 0;

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setAcknowledgedActualRun(false);
    onOpenChange(nextOpen);
  };

  const [inputRows, setInputRows] = useState<RunInputRow[]>([]);
  const emittedInput = useRef<Record<string, unknown> | null>(null);
  const inputSession = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      inputSession.current = null;
      return;
    }
    const session = String(workflow?.id ?? "");
    if (inputSession.current === session && runInput === emittedInput.current)
      return;
    inputSession.current = session;
    const rows = runInputRowsFromValue(runInput || {});
    setInputRows(rows);
    setInputErrors(readRunInputRows(rows).errors);
  }, [open, runInput, workflow?.id]);
  const updateInputRows = (rows: RunInputRow[]) => {
    setInputRows(rows);
    const parsed = readRunInputRows(rows);
    setInputErrors(parsed.errors);
    if (parsed.errors.length === 0) {
      emittedInput.current = parsed.input;
      onChangeRunInput(parsed.input);
    }
  };
  const utils = trpc.useUtils();

  // Mutations
  const runWorkflowMutation = trpc.workflow.run.useMutation();
  const runDataflowMutation = trpc.data.run.useMutation();

  // Queries for run details
  const workflowRunQuery = trpc.workflow.runDetail.useQuery(
    { runId: activeRunId || "" },
    {
      enabled: Boolean(activeRunId && !isDataflow && open),
      refetchInterval: query => {
        const status = query.state.data?.status;
        return status === "success" ||
          status === "failed" ||
          status === "cancelled" ||
          status === "terminated"
          ? false
          : 800;
      },
    }
  );

  const dataflowRunQuery = trpc.data.runDetail.useQuery(
    { projectId: workflow?.projectId || "", runId: activeRunId || "" },
    {
      enabled: Boolean(
        activeRunId && isDataflow && workflow?.projectId && open
      ),
      refetchInterval: query => {
        const status = (query.state.data as any)?.status;
        return status === "success" || status === "failed" ? false : 800;
      },
    }
  );

  const dataflowLineageQuery = trpc.data.runLineage.useQuery(
    { projectId: workflow?.projectId || "", runId: activeRunId || "" },
    {
      enabled: Boolean(
        activeRunId && isDataflow && workflow?.projectId && open
      ),
    }
  );

  // Map node IDs to names from canvas definition
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, { name: string; type: string }>();
    const nodes = definition?.nodes || [];
    for (const n of nodes) {
      map.set(String(n.id), {
        name: n.name || n.data?.label || String(n.id),
        type: n.type || n.data?.kind || "node",
      });
    }
    return map;
  }, [definition]);

  // Aggregate current run info
  const currentRun = useMemo(() => {
    if (!activeRunId) return null;
    if (isDataflow) {
      const data = dataflowRunQuery.data;
      if (!data || data.id !== activeRunId) return null;
      return {
        id: data.id,
        status: data.status,
        executionSource: data.executionSource ?? null,
        definitionVersion: data.definitionVersion ?? null,
        durationMs: data.durationMs,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        input: data.input ?? {},
        output: data.output,
        error: data.error,
        nodeRuns: data.nodeRuns || [],
      };
    } else {
      const data = workflowRunQuery.data;
      if (!data || data.id !== activeRunId) return null;
      return {
        id: data.id,
        status: data.status,
        executionSource: data.executionSource ?? null,
        definitionVersion: data.definitionVersion ?? null,
        durationMs: data.durationMs,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        input:
          typeof data.inputJson === "string"
            ? JSON.parse(data.inputJson)
            : (data.inputJson ?? {}),
        output: data.finalOutputJson
          ? typeof data.finalOutputJson === "string"
            ? JSON.parse(data.finalOutputJson)
            : data.finalOutputJson
          : null,
        error: data.errorJson
          ? typeof data.errorJson === "string"
            ? JSON.parse(data.errorJson)
            : data.errorJson
          : null,
        nodeRuns: (data.nodeRuns || []).map((nr: any) => ({
          ...nr,
          input:
            typeof nr.inputJson === "string"
              ? JSON.parse(nr.inputJson || "{}")
              : nr.inputJson,
          output:
            typeof nr.outputJson === "string"
              ? JSON.parse(nr.outputJson || "{}")
              : nr.outputJson,
          error:
            typeof nr.errorJson === "string"
              ? JSON.parse(nr.errorJson || "null")
              : nr.errorJson,
        })),
      };
    }
  }, [activeRunId, isDataflow, dataflowRunQuery.data, workflowRunQuery.data]);

  const dataResults = useMemo(
    () => (isDataflow ? dataflowTerminalResults(currentRun?.output) : []),
    [isDataflow, currentRun?.output]
  );
  // Derive tabular rows from output if available
  const outputRows = useMemo(() => {
    if (!currentRun?.output) return null;
    if (isDataflow) return dataResults[selectedTerminal]?.rows ?? null;
    const out = currentRun.output;
    if (Array.isArray(out)) return out;
    if (Array.isArray(out.rows)) return out.rows;
    if (Array.isArray(out.data)) return out.data;
    if (Array.isArray(out.result)) return out.result;
    return null;
  }, [currentRun?.output, isDataflow, dataResults, selectedTerminal]);

  const outputColumns = useMemo(() => {
    if (!outputRows || !outputRows.length) return [];
    if (isDataflow) return dataflowResultColumns(outputRows);
    const first = outputRows[0];
    if (typeof first !== "object" || first === null) return ["value"];
    return Object.keys(first);
  }, [outputRows, isDataflow]);

  useEffect(() => {
    setOutputPage(1);
    setSelectedTerminal(0);
    setResultDisplayMode("table");
  }, [activeRunId, open]);

  const totalOutputRows = outputRows?.length ?? 0;
  const totalOutputPages = Math.max(
    1,
    Math.ceil(totalOutputRows / OUTPUT_PAGE_SIZE)
  );
  const paginatedOutputRows = useMemo(() => {
    if (!outputRows) return [];
    const start = (outputPage - 1) * OUTPUT_PAGE_SIZE;
    return outputRows.slice(start, start + OUTPUT_PAGE_SIZE);
  }, [outputRows, outputPage]);

  const handleStartRun = async () => {
    if (!workflow?.id || !canStartActualRun) return;
    setActiveRunId(null);
    setIsRunning(true);
    setAcknowledgedActualRun(false);
    setRunError(null);
    setViewMode("result");
    setActiveTab("result");

    try {
      await runAfterDraftSave({
        workflowStatus: String(workflow?.status ?? "draft"),
        saveDraft: onSaveDraft,
        run: async () => {
          if (isDataflow) {
            if (!workflow.projectId) {
              throw new Error("数据流缺少所属业务项目，无法执行。");
            }
            const res = await runDataflowMutation.mutateAsync({
              projectId: workflow.projectId,
              workflowId: workflow.id,
              mode: workflow.status === "published" ? "formal" : "test",
              data: runInput,
            });
            setActiveRunId(res.runId);
            void utils.data.runs.invalidate({ projectId: workflow.projectId });
            if ((res.status as string) === "failed") {
              setRunError("数据流执行未通过校验或内部算子失败");
            }
          } else {
            const idempotencyKey = Array.from(
              crypto.getRandomValues(new Uint8Array(16)),
              byte => byte.toString(16).padStart(2, "0")
            ).join("");
            const res = await runWorkflowMutation.mutateAsync({
              workflowId: workflow.id,
              input: runInput,
              idempotencyKey,
              triggerType: "test",
            });
            setActiveRunId(res.runId);
            void utils.workflow.runs.invalidate();
          }
        },
      });
    } catch (err: any) {
      if (err instanceof DraftSaveBeforeRunError) {
        const message =
          err.originalError instanceof Error
            ? err.originalError.message
            : String(err.originalError);
        setRunError(`草稿保存失败，未启动运行：${message}`);
        return;
      }
      const msg = err?.message || String(err) || "启动运行失败";
      setRunError(msg);
      toast.error(msg);
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyJson = (content: any) => {
    navigator.clipboard.writeText(JSON.stringify(content, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("已复制到剪贴板");
  };

  const isCompleted =
    currentRun?.status === "success" || currentRun?.status === "failed";

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl sm:max-w-5xl max-h-[calc(100dvh-1rem)] min-h-0 flex flex-col p-0 overflow-hidden border-border shadow-2xl">
        {/* Modal Header */}
        <DialogHeader className="shrink-0 border-b border-border bg-muted/70 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-2xs ${
                  isStateflow
                    ? "bg-emerald-600"
                    : isDataflow
                      ? "bg-violet-600"
                      : "bg-blue-600"
                }`}
              >
                {isStateflow ? <Compass size={17} /> : <Play size={17} />}
              </div>
              <div className="min-w-0">
                <DialogTitle className="aiflow-type-section-title flex min-w-0 flex-wrap items-center gap-2 font-semibold text-foreground">
                  <span>
                    {isStateflow
                      ? "状态流程运行"
                      : isDataflow
                        ? "数据流程运行"
                        : "控制流程运行"}
                  </span>
                  <span className="aiflow-type-meta rounded border border-border/60 bg-muted px-2 py-0.5 font-medium text-foreground">
                    {isStateflow
                      ? "业务状态与人工办理"
                      : isDataflow
                        ? "数据处理与结果输出"
                        : "系统动作与条件分支"}
                  </span>
                  {workflow?.status === "published" ? (
                    <span className="aiflow-type-meta rounded border border-aiflow-success-border/60 bg-aiflow-success-surface px-2 py-0.5 font-medium text-aiflow-success">
                      已发布态
                    </span>
                  ) : (
                    <span className="aiflow-type-meta rounded border border-aiflow-warning-border/60 bg-aiflow-warning-surface px-2 py-0.5 font-medium text-aiflow-warning">
                      当前草稿
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="aiflow-type-body mt-1 text-muted-foreground">
                  {workflow?.status === "published"
                    ? hasUnpublishedChanges
                      ? `画布有未发布修改；本次会执行已发布版本 v${workflow.definitionVersion ?? 1}。发布新版本后才能按这些修改运行。`
                      : `本次会执行已发布版本 v${workflow.definitionVersion ?? 1}。`
                    : onSaveDraft
                      ? "运行前会先保存当前画布；只有保存成功才会启动运行。"
                      : `本次会按服务端已保存的草稿定义 v${workflow?.definitionVersion ?? 1} 运行。`}{" "}
                </DialogDescription>
                {executionPermissionHint && <p role="status" className="mt-2 text-sm text-muted-foreground">{executionPermissionHint}</p>}
                {isDataflow && dataProjectAccess.isError && <Button type="button" variant="outline" size="sm" className="mt-2" disabled={dataProjectAccess.isFetching} onClick={() => void dataProjectAccess.refetch()}>重新加载项目权限</Button>}
              </div>
            </div>

            {/* View Mode Switch */}
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {viewMode === "result" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="aiflow-type-control h-11 text-muted-foreground min-[1024px]:h-9"
                  onClick={() => setViewMode("config")}
                >
                  <SlidersHorizontal size={13} className="mr-1.5" />
                  配置初始上下文
                </Button>
              )}
              {viewMode === "config" && currentRun && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="aiflow-type-control h-11 border-aiflow-info-border bg-aiflow-info-surface/50 text-aiflow-info min-[1024px]:h-9"
                  onClick={() => setViewMode("result")}
                >
                  查看运行轨迹
                </Button>
              )}
            </div>
          </div>

          {/* Status banner when in result view */}
          {viewMode === "result" && (
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border/80 bg-card p-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                {isRunning || (!isCompleted && activeRunId && !runError) ? (
                  currentRun?.status === "waiting" ||
                  currentRun?.status === "blocked" ? (
                    <div className="aiflow-type-body flex items-center gap-2 font-semibold text-aiflow-warning">
                      <Clock size={16} className="text-aiflow-warning" />
                      <span>
                        {isStateflow
                          ? "流转挂起：等待参与人审批操作"
                          : "流程等待外部事件挂起"}
                      </span>
                    </div>
                  ) : (
                    <div className="aiflow-type-body flex items-center gap-2 font-semibold text-aiflow-info">
                      <Loader2
                        size={16}
                        className="animate-spin text-aiflow-info"
                      />
                      <span>
                        {currentRun?.status === "queued"
                          ? "运行已排队，等待执行器…"
                          : "流程执行中…"}
                      </span>
                    </div>
                  )
                ) : currentRun?.status === "success" ? (
                  <div className="aiflow-type-body flex items-center gap-2 font-semibold text-aiflow-success">
                    <CheckCircle2 size={16} className="text-aiflow-success" />
                    <span>
                      {isStateflow ? "状态流转抵达终态" : "执行顺利完成"}
                    </span>
                  </div>
                ) : currentRun?.status === "failed" || runError ? (
                  <div className="aiflow-type-body flex items-center gap-2 font-semibold text-red-700">
                    <XCircle size={16} className="text-red-600" />
                    <span>{isStateflow ? "状态流转异常阻断" : "运行失败"}</span>
                  </div>
                ) : (
                  <div className="aiflow-type-body font-medium text-muted-foreground">
                    准备就绪
                  </div>
                )}

                {activeRunId && (
                  <span className="aiflow-type-meta rounded bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                    ID: {activeRunId.slice(0, 8)}
                  </span>
                )}
                {currentRun && (
                  <span className="aiflow-type-meta rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                    {currentRun.executionSource === "published_plan"
                      ? "已发布执行计划"
                      : currentRun.executionSource === "saved_definition"
                        ? "已发布定义（未记录执行计划）"
                        : currentRun.executionSource === "draft"
                          ? "当前草稿"
                          : "旧运行记录：未记录执行版本"}
                    {currentRun.definitionVersion !== null &&
                    currentRun.definitionVersion !== undefined
                      ? ` · v${currentRun.definitionVersion}`
                      : ""}
                  </span>
                )}
                {currentRun?.durationMs !== undefined &&
                  currentRun?.durationMs !== null && (
                    <span className="aiflow-type-meta text-muted-foreground">
                      耗时:{" "}
                      <strong className="text-foreground">
                        {String(currentRun.durationMs)} ms
                      </strong>
                    </span>
                  )}
              </div>

              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button
                  type="button"
                  size="sm"
                  className="aiflow-type-control h-11 min-h-11 w-full justify-center bg-blue-600 text-white hover:bg-blue-700 sm:w-auto min-[1024px]:h-9 min-[1024px]:min-h-0"
                  disabled={!canStartActualRun}
                  title={
                    !canExecute
                      ? executionPermissionHint
                      : !acknowledgedActualRun
                        ? "请先确认本次会执行真实流程"
                        : undefined
                  }
                  onClick={handleStartRun}
                >
                  {isRunning ? (
                    <Loader2 size={13} className="animate-spin mr-1" />
                  ) : (
                    <RefreshCw size={13} className="mr-1" />
                  )}
                  再次创建实际运行
                </Button>
              </div>
            </div>
          )}
          {viewMode === "result" && (
            <ActualRunAcknowledgement
              checked={acknowledgedActualRun}
              onChange={setAcknowledgedActualRun}
            />
          )}
        </DialogHeader>

        {/* Modal Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/30 p-4 sm:p-6">
          {viewMode === "config" ? (
            /* Parameter Configuration View */
            <div className="mx-auto w-full max-w-2xl min-w-0 py-2">
              <div className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="aiflow-type-section-title flex items-center gap-2 font-semibold text-foreground">
                      <SlidersHorizontal
                        size={15}
                        className="text-aiflow-info"
                      />
                      配置运行输入
                    </h3>
                    <p className="aiflow-type-body mt-0.5 text-muted-foreground">
                      业务编号请选择文本以保留前导零；可明确选择数值、布尔或
                      JSON。自动识别会保留带前导零或超出安全整数范围的编号。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="aiflow-type-control h-11 min-h-11 shrink-0 border-aiflow-info-border text-aiflow-info hover:bg-aiflow-info-surface min-[1024px]:h-9 min-[1024px]:min-h-0"
                    onClick={() =>
                      updateInputRows([...inputRows, { key: "", value: "" }])
                    }
                  >
                    <Plus size={13} className="mr-1" />
                    添加字段
                  </Button>
                </div>

                <div className="mt-4 space-y-2.5">
                  {!inputRows.length && (
                    <div className="aiflow-type-body rounded border border-dashed border-border bg-muted p-4 text-center text-muted-foreground">
                      当前未配置输入字段。确认流程无需额外输入后，可发起本次实际运行。
                    </div>
                  )}

                  {inputRows.map((row, index) => (
                    <div
                      key={index}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem_2.75rem] items-center gap-2 sm:grid-cols-[minmax(100px,0.35fr)_7rem_minmax(0,1fr)_2.75rem]"
                    >
                      <Input
                        placeholder="字段名 (key)"
                        aria-label={`输入字段 ${index + 1} 名称`}
                        className="aiflow-type-control col-span-2 h-11 min-h-11 min-w-0 sm:col-span-1 font-mono min-[1024px]:h-9 min-[1024px]:min-h-0"
                        value={row.key}
                        onChange={e =>
                          updateInputRows(
                            inputRows.map((r, i) =>
                              i === index ? { ...r, key: e.target.value } : r
                            )
                          )
                        }
                      />
                      <select
                        aria-label={`输入字段 ${index + 1} 类型`}
                        value={row.kind ?? "auto"}
                        className="aiflow-type-control col-start-2 row-start-2 h-11 min-w-0 rounded-md border border-border bg-background px-2 sm:col-start-auto sm:row-start-auto min-[1024px]:h-9"
                        onChange={event =>
                          updateInputRows(
                            inputRows.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    kind: event.target.value as RunInputKind,
                                  }
                                : item
                            )
                          )
                        }
                      >
                        <option value="auto">自动识别</option>
                        <option value="text">文本</option>
                        <option value="number">数值</option>
                        <option value="boolean">布尔</option>
                        <option value="json">JSON</option>
                      </select>
                      <Input
                        placeholder="字段值 (value，支持文本/数字/JSON)"
                        aria-label={`输入字段 ${index + 1} 的值`}
                        className="aiflow-type-control col-start-1 row-start-2 h-11 min-h-11 min-w-0 sm:col-start-auto sm:row-start-auto min-[1024px]:h-9 min-[1024px]:min-h-0"
                        value={row.value}
                        onChange={e =>
                          updateInputRows(
                            inputRows.map((r, i) =>
                              i === index ? { ...r, value: e.target.value } : r
                            )
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`删除输入字段 ${row.key || index + 1}`}
                        className="aiflow-type-control col-start-3 row-start-1 flex h-11 min-h-11 w-11 items-center justify-center rounded text-muted-foreground sm:col-start-4 transition-colors hover:bg-red-50 hover:text-red-600 min-[1024px]:h-9 min-[1024px]:min-h-0 min-[1024px]:w-9"
                        onClick={() =>
                          updateInputRows(
                            inputRows.filter((_, i) => i !== index)
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>

                {inputErrors.length > 0 && (
                  <div
                    role="alert"
                    className="mt-3 rounded-md border border-aiflow-danger-border bg-aiflow-danger-surface p-3 text-sm text-aiflow-danger"
                  >
                    {inputErrors.map((error, i) => (
                      <p key={i}>{error}</p>
                    ))}
                  </div>
                )}
                <div
                  role="note"
                  className="aiflow-type-body mt-5 flex items-start gap-2 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface p-3 leading-5 text-amber-900"
                >
                  <AlertTriangle
                    className="mt-0.5 shrink-0 text-aiflow-warning"
                    size={15}
                  />
                  <p>
                    <span className="font-semibold">实际运行提示：</span>
                    提交后会直接执行并创建运行记录；当前入口不提供沙箱隔离，节点可能读写已配置资源或调用外部服务。
                  </p>
                </div>
                <ActualRunAcknowledgement
                  checked={acknowledgedActualRun}
                  onChange={setAcknowledgedActualRun}
                />
                <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
                  <Button
                    type="button"
                    className="min-h-11 w-full justify-center bg-blue-600 font-medium text-white hover:bg-blue-700 sm:w-auto"
                    size="sm"
                    disabled={!canStartActualRun}
                    title={
                      !canExecute
                        ? executionPermissionHint
                        : !acknowledgedActualRun
                          ? "请先确认本次会执行真实流程"
                          : undefined
                    }
                    onClick={handleStartRun}
                  >
                    {isRunning ? (
                      <Loader2 size={14} className="animate-spin mr-1.5" />
                    ) : isStateflow ? (
                      <Compass size={14} className="mr-1.5" />
                    ) : (
                      <Play size={14} className="mr-1.5" />
                    )}
                    {isStateflow
                      ? "开始实际状态流转"
                      : isDataflow
                        ? "开始实际数据流程"
                        : "开始实际控制流程"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* Results View */
            <div className="space-y-4">
              {/* State flow waiting prompt */}
              {isStateflow &&
                (currentRun?.status === "waiting" ||
                  currentRun?.status === "blocked") && (
                  <div className="rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface/80 p-3.5 shadow-2xs">
                    <div className="flex items-start gap-3">
                      <Clock className="h-5 w-5 text-aiflow-warning shrink-0 mt-0.5" />
                      <div className="aiflow-type-body text-aiflow-warning">
                        <p className="font-semibold text-amber-900">
                          状态流转已就绪：当前处于等待参与人操作（审批/签署/提交）阶段
                        </p>
                        <p className="mt-1 leading-relaxed text-aiflow-warning">
                          状态流程本质是长周期的业务对象生命周期，当前节点已成功流转至人工待办任务。在实际业务运行中，需由对应角色成员（如经办人、风控初审员、主管）在【已启动流程-工作台】中完成审批后方可继续流转。下方已为您呈现当前到达的状态节点与上下文数据。
                        </p>
                      </div>
                    </div>
                  </div>
                )}

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-border bg-card px-3 py-1 rounded-t-lg">
                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === "result"
                      ? "border-blue-600 text-aiflow-info"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab("result")}
                >
                  <FileSpreadsheet size={14} />
                  <span>
                    {isStateflow ? "当前状态与业务上下文" : "最终输出结果"}
                  </span>
                  {outputRows && (
                    <span className="rounded bg-aiflow-info-surface/70 px-1.5 py-0.2 text-[10px] text-aiflow-info font-semibold">
                      {outputRows.length} 条
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === "steps"
                      ? "border-blue-600 text-aiflow-info"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab("steps")}
                >
                  <Layers size={14} />
                  <span>
                    {isStateflow ? "状态跃迁与节点轨迹" : "算子执行明细"}
                  </span>
                  {Boolean(
                    currentRun?.nodeRuns?.length ||
                      dataflowLineageQuery.data?.artifacts?.length
                  ) && (
                    <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">
                      {currentRun?.nodeRuns?.length ||
                        dataflowLineageQuery.data?.artifacts?.length}{" "}
                      节点
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === "input"
                      ? "border-blue-600 text-aiflow-info"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab("input")}
                >
                  <SlidersHorizontal size={14} />
                  <span>输入参数</span>
                </button>
              </div>

              {/* Tab 1: Result Output */}
              {activeTab === "result" && (
                <div className="rounded-b-lg border border-t-0 border-border bg-card p-4 shadow-sm min-h-[300px]">
                  {/* Error view if failed */}
                  {(runError || currentRun?.error) && (
                    <div className="aiflow-type-body mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle
                          size={18}
                          className="text-red-600 mt-0.5 flex-shrink-0"
                        />
                        <div className="flex-1">
                          <p className="font-semibold text-red-950">
                            执行未通过或报错中断
                          </p>
                          <p className="mt-1 leading-5 text-red-800">
                            {typeof currentRun?.error === "string"
                              ? currentRun.error
                              : currentRun?.error?.message ||
                                runError ||
                                "节点运行抛出异常，请检查节点配置。"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Loading State */}
                  {isRunning && !currentRun?.output && (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <Loader2
                        size={32}
                        className="animate-spin text-blue-500 mb-3"
                      />
                      <p className="text-sm font-medium text-foreground">
                        正在执行流程算子计算…
                      </p>
                      <p className="aiflow-type-body mt-1 text-muted-foreground">
                        系统正在处理流转数据并生成各算子输出，请稍候
                      </p>
                    </div>
                  )}

                  {/* Output Display */}
                  {!isRunning && currentRun?.output && (
                    <div>
                      {dataResults.length > 1 && (
                        <label className="aiflow-type-control mb-3 flex flex-wrap items-center gap-2">
                          结果集
                          <select
                            aria-label="选择最终结果集"
                            className="h-11 max-w-full rounded-md border border-border bg-background px-3 min-[1024px]:h-9"
                            value={selectedTerminal}
                            onChange={event => {
                              setSelectedTerminal(Number(event.target.value));
                              setOutputPage(1);
                              setResultDisplayMode("table");
                            }}
                          >
                            {dataResults.map((result, index) => (
                              <option key={index} value={index}>
                                {result.name} · {result.rows.length} 行
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {/* Top Bar for Result Format Toggle */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            输出内容
                            {isDataflow && dataResults.length === 1 && (
                              <span className="ml-2 font-normal text-muted-foreground">
                                {dataResults[0].name}
                              </span>
                            )}
                          </span>
                          {outputRows && (
                            <span className="text-xs text-muted-foreground">
                              (共 {outputRows.length} 行记录)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {outputRows && (
                            <div className="flex rounded-md border border-border bg-muted p-0.5 text-xs">
                              <button
                                type="button"
                                className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                  resultDisplayMode === "table"
                                    ? "bg-card text-aiflow-info shadow-xs"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => setResultDisplayMode("table")}
                              >
                                <TableIcon size={13} />
                                表格预览
                              </button>
                              <button
                                type="button"
                                className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                  resultDisplayMode === "json"
                                    ? "bg-card text-aiflow-info shadow-xs"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                                onClick={() => setResultDisplayMode("json")}
                              >
                                <Code2 size={13} />
                                JSON 格式
                              </button>
                            </div>
                          )}

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-muted-foreground"
                            onClick={() => handleCopyJson(currentRun.output)}
                          >
                            {copied ? (
                              <Check
                                size={13}
                                className="text-aiflow-success mr-1"
                              />
                            ) : (
                              <Copy size={13} className="mr-1" />
                            )}
                            复制结果
                          </Button>
                        </div>
                      </div>

                      {/* Tabular Data View */}
                      {outputRows && resultDisplayMode === "table" ? (
                        <div className="space-y-2">
                          <div className="overflow-x-auto rounded border border-border max-h-[360px]">
                            <table className="w-full text-left text-xs">
                              <thead className="sticky top-0 z-10 bg-muted text-sm text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-2 w-12 text-muted-foreground font-mono">
                                    #
                                  </th>
                                  {outputColumns.map(col => (
                                    <th
                                      key={col}
                                      className="px-3 py-2 font-semibold text-foreground whitespace-nowrap"
                                    >
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {paginatedOutputRows.map(
                                  (row: any, idx: number) => {
                                    const rowIndex =
                                      (outputPage - 1) * OUTPUT_PAGE_SIZE + idx;
                                    return (
                                      <tr
                                        key={rowIndex}
                                        className="hover:bg-aiflow-info-surface/40 transition-colors"
                                      >
                                        <td className="px-3 py-2 text-muted-foreground font-mono text-[11px]">
                                          {rowIndex + 1}
                                        </td>
                                        {outputColumns.map(col => {
                                          const val =
                                            typeof row === "object" &&
                                            row !== null
                                              ? row[col]
                                              : row;
                                          return (
                                            <td
                                              key={col}
                                              className="px-3 py-2 text-foreground whitespace-nowrap max-w-xs truncate"
                                              title={
                                                val === null ||
                                                val === undefined
                                                  ? ""
                                                  : typeof val === "object"
                                                    ? JSON.stringify(val)
                                                    : String(val)
                                              }
                                            >
                                              {val === null ||
                                              val === undefined ? (
                                                <span className="text-slate-300 italic">
                                                  null
                                                </span>
                                              ) : typeof val === "boolean" ? (
                                                <span
                                                  className={
                                                    val
                                                      ? "text-aiflow-success font-semibold"
                                                      : "text-muted-foreground"
                                                  }
                                                >
                                                  {String(val)}
                                                </span>
                                              ) : typeof val === "object" ? (
                                                <code className="text-[10px] text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded">
                                                  {JSON.stringify(val)}
                                                </code>
                                              ) : (
                                                String(val)
                                              )}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  }
                                )}
                              </tbody>
                            </table>
                          </div>
                          {totalOutputPages > 1 && (
                            <div className="flex items-center justify-between px-1 py-1 text-xs text-muted-foreground border-t border-border pt-2">
                              <span>
                                显示第 {(outputPage - 1) * OUTPUT_PAGE_SIZE + 1}{" "}
                                ~{" "}
                                {Math.min(
                                  outputPage * OUTPUT_PAGE_SIZE,
                                  totalOutputRows
                                )}{" "}
                                条，共 {totalOutputRows} 条
                              </span>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  disabled={outputPage <= 1}
                                  onClick={() =>
                                    setOutputPage(p => Math.max(1, p - 1))
                                  }
                                >
                                  上一页
                                </Button>
                                <span className="font-mono text-xs px-1 text-muted-foreground">
                                  {outputPage} / {totalOutputPages}
                                </span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  disabled={outputPage >= totalOutputPages}
                                  onClick={() =>
                                    setOutputPage(p =>
                                      Math.min(totalOutputPages, p + 1)
                                    )
                                  }
                                >
                                  下一页
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* JSON / Code View */
                        <pre className="aiflow-type-code max-h-[380px] overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-emerald-300">
                          {JSON.stringify(currentRun.output, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}

                  {!isRunning &&
                    !currentRun?.output &&
                    !runError &&
                    !currentRun?.error && (
                      <div className="aiflow-type-body py-12 text-center text-muted-foreground">
                        本次运行未返回结构化输出，请查看“算子执行明细”。
                      </div>
                    )}
                </div>
              )}

              {/* Tab 2: Execution Steps / Node Details */}
              {activeTab === "steps" && (
                <div className="rounded-b-lg border border-t-0 border-border bg-card p-4 shadow-sm min-h-[300px]">
                  <p className="aiflow-type-body mb-3 text-muted-foreground">
                    按照流程拓扑顺序记录各算子的实际执行状态、耗时与输入输出数据：
                  </p>

                  <div className="space-y-2">
                    {/* Dataflow Artifacts / Nodes */}
                    {isDataflow &&
                      (currentRun?.nodeRuns?.length
                        ? currentRun.nodeRuns
                        : dataflowLineageQuery.data?.artifacts || []
                      ).map((item: any, index: number) => {
                        const nodeId = String(item.nodeId);
                        const nodeInfo = nodeNameMap.get(nodeId);
                        const artifact = (
                          dataflowLineageQuery.data?.artifacts || []
                        ).find((a: any) => String(a.nodeId) === nodeId);
                        const isExpanded = expandedNodeId === item.id;
                        const isSuccess =
                          item.status === "success" || !item.status;
                        const rowCount =
                          item.rowCount ??
                          (artifact as any)?.rowCount ??
                          (Array.isArray(item.output?.rows)
                            ? item.output.rows.length
                            : null);
                        return (
                          <div
                            key={item.id}
                            className="rounded-lg border border-border bg-muted/50 overflow-hidden"
                          >
                            <div
                              className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-muted/60 transition-colors"
                              onClick={() =>
                                setExpandedNodeId(isExpanded ? null : item.id)
                              }
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-aiflow-info-surface text-[10px] font-bold text-aiflow-info">
                                  {index + 1}
                                </span>
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    isSuccess ? "bg-emerald-500" : "bg-red-500"
                                  }`}
                                />
                                <span className="text-xs font-semibold text-foreground">
                                  {nodeInfo?.name || item.nodeId}
                                </span>
                                <code className="text-[10px] bg-slate-200 text-muted-foreground px-1.5 py-0.5 rounded uppercase">
                                  {item.nodeType || nodeInfo?.type}
                                </code>
                              </div>

                              <div className="flex items-center gap-3">
                                {rowCount !== null &&
                                  rowCount !== undefined && (
                                    <span className="text-xs font-medium text-aiflow-info bg-aiflow-info-surface px-2 py-0.5 rounded border border-aiflow-info-border/50">
                                      产出 {rowCount} 行
                                    </span>
                                  )}
                                {item.durationMs !== undefined &&
                                  item.durationMs !== null && (
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {item.durationMs} ms
                                    </span>
                                  )}
                                {isExpanded ? (
                                  <ChevronDown
                                    size={15}
                                    className="text-muted-foreground"
                                  />
                                ) : (
                                  <ChevronRight
                                    size={15}
                                    className="text-muted-foreground"
                                  />
                                )}
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="border-t border-border bg-card p-3.5 space-y-3">
                                {item.error && (
                                  <div className="aiflow-type-body rounded border border-red-200 bg-red-50 p-2.5 text-red-700">
                                    <p className="font-semibold text-red-900 mb-0.5">
                                      算子执行失败
                                    </p>
                                    <pre className="aiflow-type-code whitespace-pre-wrap font-mono">
                                      {typeof item.error === "string"
                                        ? item.error
                                        : item.error?.message ||
                                          JSON.stringify(item.error)}
                                    </pre>
                                  </div>
                                )}
                                {artifact?.sample?.length ||
                                (Array.isArray(item.output?.rows) &&
                                  item.output.rows.length) ? (
                                  <div>
                                    <p className="aiflow-type-body mb-1.5 font-semibold text-muted-foreground">
                                      节点输出数据 (
                                      {artifact?.sample?.length ||
                                        item.output?.rows?.length}{" "}
                                      条)
                                    </p>
                                    <pre className="aiflow-type-code max-h-40 overflow-auto rounded bg-slate-900 p-2.5 font-mono text-emerald-300">
                                      {JSON.stringify(
                                        artifact?.sample || item.output?.rows,
                                        null,
                                        2
                                      )}
                                    </pre>
                                  </div>
                                ) : item.output ? (
                                  <div>
                                    <p className="aiflow-type-body mb-1.5 font-semibold text-muted-foreground">
                                      节点输出
                                    </p>
                                    <pre className="aiflow-type-code max-h-40 overflow-auto rounded bg-slate-900 p-2.5 font-mono text-emerald-300">
                                      {JSON.stringify(item.output, null, 2)}
                                    </pre>
                                  </div>
                                ) : null}
                                {artifact?.schema &&
                                  artifact.schema.length > 0 && (
                                    <div>
                                      <p className="text-[11px] font-semibold text-muted-foreground mb-1">
                                        字段 Schema
                                      </p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {artifact.schema.map(
                                          (f: any, fi: number) => (
                                            <span
                                              key={fi}
                                              className="aiflow-type-code rounded border border-border bg-muted px-2 py-0.5 font-mono text-foreground"
                                            >
                                              {f.name}: {f.type}
                                            </span>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                    {/* Standard Workflow Node Runs */}
                    {!isDataflow &&
                      currentRun?.nodeRuns?.map((node: any, index: number) => {
                        const isExpanded = expandedNodeId === node.id;
                        const isSuccess = node.status === "success";
                        return (
                          <div
                            key={node.id}
                            className="rounded-lg border border-border bg-muted/50 overflow-hidden"
                          >
                            <div
                              className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-muted/60 transition-colors"
                              onClick={() =>
                                setExpandedNodeId(isExpanded ? null : node.id)
                              }
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-aiflow-info-surface text-[10px] font-bold text-aiflow-info">
                                  {index + 1}
                                </span>
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    isSuccess ? "bg-emerald-500" : "bg-red-500"
                                  }`}
                                />
                                <span className="aiflow-type-body font-semibold text-foreground">
                                  {node.nodeName || node.nodeId}
                                </span>
                                <code className="text-[10px] bg-slate-200 text-muted-foreground px-1.5 py-0.5 rounded">
                                  {node.nodeType}
                                </code>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="text-xs text-muted-foreground font-mono">
                                  {node.durationMs ?? 0} ms
                                </span>
                                {isExpanded ? (
                                  <ChevronDown
                                    size={15}
                                    className="text-muted-foreground"
                                  />
                                ) : (
                                  <ChevronRight
                                    size={15}
                                    className="text-muted-foreground"
                                  />
                                )}
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="border-t border-border bg-card p-3.5 grid gap-3 sm:grid-cols-2">
                                <div>
                                  <p className="aiflow-type-body mb-1 font-semibold text-muted-foreground">
                                    节点输入
                                  </p>
                                  <pre className="aiflow-type-code max-h-36 overflow-auto rounded bg-slate-900 p-2 text-slate-200">
                                    {JSON.stringify(node.input || {}, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <p className="aiflow-type-body mb-1 font-semibold text-muted-foreground">
                                    {node.error ? "节点报错" : "节点输出"}
                                  </p>
                                  <pre
                                    className={`aiflow-type-code max-h-36 overflow-auto rounded p-2 ${
                                      node.error
                                        ? "bg-red-950 text-red-200"
                                        : "bg-slate-900 text-emerald-300"
                                    }`}
                                  >
                                    {JSON.stringify(
                                      node.error || node.output || {},
                                      null,
                                      2
                                    )}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                    {!dataflowLineageQuery.data?.artifacts?.length &&
                      !currentRun?.nodeRuns?.length && (
                        <div className="aiflow-type-body py-8 text-center text-muted-foreground">
                          {isRunning
                            ? "正在搜集各节点执行信息…"
                            : "暂无节点执行明细"}
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Tab 3: Run Input Parameters */}
              {activeTab === "input" && (
                <div className="rounded-b-lg border border-t-0 border-border bg-card p-4 shadow-sm min-h-[300px]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="aiflow-type-body text-muted-foreground">
                      本次运行提交的输入字段：
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-aiflow-info"
                      onClick={() => setViewMode("config")}
                    >
                      修改参数
                    </Button>
                  </div>

                  {Object.keys(currentRun?.input || {}).length > 0 ? (
                    <pre className="aiflow-type-code max-h-[350px] overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-blue-300">
                      {JSON.stringify(currentRun?.input ?? {}, null, 2)}
                    </pre>
                  ) : (
                    <div className="aiflow-type-body py-8 text-center text-muted-foreground">
                      本次运行未传入额外自定义输入参数（使用默认配置运行）。
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-muted px-4 py-3 sm:px-6">
          <div className="aiflow-type-meta flex min-w-0 flex-1 flex-col gap-0.5 text-muted-foreground">
            <span
              className="block truncate font-mono"
              title={workflow?.name || "当前流程"}
            >
              {workflow?.name || "当前流程"}
            </span>
            <span>本页展示本次运行结果与节点轨迹</span>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="aiflow-type-control h-11 min-h-11 shrink-0 px-4 min-[1024px]:h-9 min-[1024px]:min-h-0"
            onClick={() => handleDialogOpenChange(false)}
          >
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActualRunAcknowledgement({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="aiflow-type-body mt-3 flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-3 py-2 leading-5 text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
      />
      <span>
        我已了解并确认：本次会直接真实执行，可能推进业务状态、读写数据或调用外部服务，且当前没有沙箱隔离。
      </span>
    </label>
  );
}
