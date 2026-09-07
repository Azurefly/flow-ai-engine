import { useState, useMemo, useEffect } from "react";
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
} from "lucide-react";

interface WorkflowTestRunModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: any;
  definition: any;
  runInput: Record<string, unknown>;
  onChangeRunInput: (input: Record<string, unknown>) => void;
  canRun: boolean;
  onSaveDraft?: () => Promise<void> | void;
}

export default function WorkflowTestRunModal({
  open,
  onOpenChange,
  workflow,
  definition,
  runInput,
  onChangeRunInput,
  canRun,
  onSaveDraft,
}: WorkflowTestRunModalProps) {
  const isDataflow = workflow?.flowType === "data";
  const [activeTab, setActiveTab] = useState<"result" | "steps" | "input">("result");
  const [viewMode, setViewMode] = useState<"config" | "result">("config");
  const [resultDisplayMode, setResultDisplayMode] = useState<"table" | "json">("table");
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Field rows for input editor
  const [inputRows, setInputRows] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    const entries = Object.entries(runInput || {});
    setInputRows(
      entries.map(([key, value]) => ({
        key,
        value: typeof value === "object" ? JSON.stringify(value) : String(value ?? ""),
      }))
    );
  }, [open, runInput]);

  const updateInputRows = (rows: Array<{ key: string; value: string }>) => {
    setInputRows(rows);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      if (!row.key.trim()) continue;
      const raw = row.value.trim();
      if (raw === "true") result[row.key] = true;
      else if (raw === "false") result[row.key] = false;
      else if (raw === "null") result[row.key] = null;
      else if (raw !== "" && !isNaN(Number(raw))) result[row.key] = Number(raw);
      else {
        try {
          if (raw.startsWith("{") || raw.startsWith("[")) {
            result[row.key] = JSON.parse(raw);
          } else {
            result[row.key] = raw;
          }
        } catch {
          result[row.key] = raw;
        }
      }
    }
    onChangeRunInput(result);
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
        return status === "success" || status === "failed" || status === "cancelled" || status === "terminated"
          ? false
          : 800;
      },
    }
  );

  const dataflowRunQuery = trpc.data.runDetail.useQuery(
    { projectId: workflow?.projectId || "", runId: activeRunId || "" },
    {
      enabled: Boolean(activeRunId && isDataflow && workflow?.projectId && open),
      refetchInterval: query => {
        const status = (query.state.data as any)?.status;
        return status === "success" || status === "failed" ? false : 800;
      },
    }
  );

  const dataflowLineageQuery = trpc.data.runLineage.useQuery(
    { projectId: workflow?.projectId || "", runId: activeRunId || "" },
    {
      enabled: Boolean(activeRunId && isDataflow && workflow?.projectId && open),
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
      if (!data) return null;
      return {
        id: data.id,
        status: data.status,
        durationMs: data.durationMs,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        output: data.output,
        error: data.error,
        nodeRuns: data.nodeRuns || [],
      };
    } else {
      const data = workflowRunQuery.data;
      if (!data) return null;
      return {
        id: data.id,
        status: data.status,
        durationMs: data.durationMs,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        output: data.finalOutputJson ? (typeof data.finalOutputJson === "string" ? JSON.parse(data.finalOutputJson) : data.finalOutputJson) : null,
        error: data.errorJson ? (typeof data.errorJson === "string" ? JSON.parse(data.errorJson) : data.errorJson) : null,
        nodeRuns: (data.nodeRuns || []).map((nr: any) => ({
          ...nr,
          input: typeof nr.inputJson === "string" ? JSON.parse(nr.inputJson || "{}") : nr.inputJson,
          output: typeof nr.outputJson === "string" ? JSON.parse(nr.outputJson || "{}") : nr.outputJson,
          error: typeof nr.errorJson === "string" ? JSON.parse(nr.errorJson || "null") : nr.errorJson,
        })),
      };
    }
  }, [activeRunId, isDataflow, dataflowRunQuery.data, workflowRunQuery.data]);

  // Derive tabular rows from output if available
  const outputRows = useMemo(() => {
    if (!currentRun?.output) return null;
    const out = currentRun.output;
    if (Array.isArray(out)) return out;
    if (Array.isArray(out.rows)) return out.rows;
    if (Array.isArray(out.data)) return out.data;
    if (Array.isArray(out.result)) return out.result;
    return null;
  }, [currentRun?.output]);

  const outputColumns = useMemo(() => {
    if (!outputRows || !outputRows.length) return [];
    const first = outputRows[0];
    if (typeof first !== "object" || first === null) return ["value"];
    return Object.keys(first);
  }, [outputRows]);

  const handleStartRun = async () => {
    if (!workflow?.id || isRunning) return;
    setIsRunning(true);
    setRunError(null);
    setViewMode("result");
    setActiveTab("result");

    try {
      // 1. Automatically save canvas draft first if hook provided
      if (onSaveDraft) {
        await onSaveDraft();
      }

      // 2. Dispatch execution
      if (isDataflow) {
        if (!workflow.projectId) {
          throw new Error("数据流缺少所属业务项目，无法执行。");
        }
        const res = await runDataflowMutation.mutateAsync({
          projectId: workflow.projectId,
          workflowId: workflow.id,
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
    } catch (err: any) {
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

  const isCompleted = currentRun?.status === "success" || currentRun?.status === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl sm:max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden border-slate-200 shadow-2xl">
        {/* Modal Header */}
        <DialogHeader className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
                <Play size={18} />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <span>流程试运行与即时结果</span>
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-200/60">
                    {isDataflow ? "数据流算子管线" : "工作流引擎"}
                  </span>
                  {workflow?.status === "published" ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
                      已发布态
                    </span>
                  ) : (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200/60">
                      草稿试运行
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 mt-0.5">
                  在设计器内即时调试执行并展示算子计算输出，无需跳出页面。
                </DialogDescription>
              </div>
            </div>

            {/* View Mode Switch */}
            <div className="flex items-center gap-2">
              {viewMode === "result" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-slate-600"
                  onClick={() => setViewMode("config")}
                >
                  <SlidersHorizontal size={13} className="mr-1.5" />
                  配置运行参数
                </Button>
              )}
              {viewMode === "config" && currentRun && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-blue-600 border-blue-200 bg-blue-50/50"
                  onClick={() => setViewMode("result")}
                >
                  查看上次结果
                </Button>
              )}
            </div>
          </div>

          {/* Status banner when in result view */}
          {viewMode === "result" && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-sm">
              <div className="flex items-center gap-3">
                {isRunning || (!isCompleted && activeRunId && !runError) ? (
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                    <Loader2 size={16} className="animate-spin text-blue-600" />
                    <span>正在调度计算…</span>
                  </div>
                ) : currentRun?.status === "success" ? (
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    <span>试运行完成</span>
                  </div>
                ) : currentRun?.status === "failed" || runError ? (
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-700">
                    <XCircle size={16} className="text-red-600" />
                    <span>试运行失败</span>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 font-medium">准备就绪</div>
                )}

                {activeRunId && (
                  <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                    ID: {activeRunId.slice(0, 8)}
                  </span>
                )}
                {currentRun?.durationMs !== undefined && currentRun?.durationMs !== null && (
                  <span className="text-xs text-slate-500">
                    耗时: <strong className="text-slate-800">{String(currentRun.durationMs)} ms</strong>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={isRunning || !canRun}
                  onClick={handleStartRun}
                >
                  {isRunning ? (
                    <Loader2 size={13} className="animate-spin mr-1" />
                  ) : (
                    <RefreshCw size={13} className="mr-1" />
                  )}
                  再次运行
                </Button>
              </div>
            </div>
          )}
        </DialogHeader>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto min-h-[380px] p-6 bg-slate-50/30">
          {viewMode === "config" ? (
            /* Parameter Configuration View */
            <div className="max-w-2xl mx-auto py-2">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <SlidersHorizontal size={15} className="text-blue-600" />
                      填写运行测试参数
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      定义将传入首个节点或用于替换变量的输入参数，数值与布尔会自动识别类型。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                    onClick={() => updateInputRows([...inputRows, { key: "", value: "" }])}
                  >
                    <Plus size={13} className="mr-1" />
                    添加字段
                  </Button>
                </div>

                <div className="mt-4 space-y-2.5">
                  {!inputRows.length && (
                    <div className="rounded border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                      当前未配置输入字段。如果此流程不需要外部输入，可直接点击“立即开始试运行”。
                    </div>
                  )}

                  {inputRows.map((row, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[160px_1fr_32px] gap-2 items-center"
                    >
                      <Input
                        placeholder="字段名 (key)"
                        className="h-8 text-xs font-mono"
                        value={row.key}
                        onChange={e =>
                          updateInputRows(
                            inputRows.map((r, i) =>
                              i === index ? { ...r, key: e.target.value } : r
                            )
                          )
                        }
                      />
                      <Input
                        placeholder="字段值 (value，支持文本/数字/JSON)"
                        className="h-8 text-xs"
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
                        className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        onClick={() =>
                          updateInputRows(inputRows.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    试运行将优先保存当前画布草稿，并在后台沙箱中完成运算
                  </div>
                  <Button
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
                    size="sm"
                    disabled={isRunning || !canRun}
                    onClick={handleStartRun}
                  >
                    {isRunning ? (
                      <Loader2 size={14} className="animate-spin mr-1.5" />
                    ) : (
                      <Play size={14} className="mr-1.5" />
                    )}
                    立即开始试运行
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* Results View */
            <div className="space-y-4">
              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-3 py-1 rounded-t-lg">
                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === "result"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                  onClick={() => setActiveTab("result")}
                >
                  <FileSpreadsheet size={14} />
                  <span>最终输出结果</span>
                  {outputRows && (
                    <span className="rounded bg-blue-100/70 px-1.5 py-0.2 text-[10px] text-blue-800 font-semibold">
                      {outputRows.length} 条
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === "steps"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                  onClick={() => setActiveTab("steps")}
                >
                  <Layers size={14} />
                  <span>算子执行明细</span>
                  {Boolean(currentRun?.nodeRuns?.length || dataflowLineageQuery.data?.artifacts?.length) && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] text-slate-600">
                      {currentRun?.nodeRuns?.length || dataflowLineageQuery.data?.artifacts?.length} 节点
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === "input"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                  onClick={() => setActiveTab("input")}
                >
                  <SlidersHorizontal size={14} />
                  <span>输入参数</span>
                </button>
              </div>

              {/* Tab 1: Result Output */}
              {activeTab === "result" && (
                <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white p-4 shadow-sm min-h-[300px]">
                  {/* Error view if failed */}
                  {(runError || currentRun?.error) && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold text-red-950">执行未通过或报错中断</p>
                          <p className="mt-1 leading-5 text-red-800">
                            {typeof currentRun?.error === "string"
                              ? currentRun.error
                              : currentRun?.error?.message || runError || "节点运行抛出异常，请检查节点配置。"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Loading State */}
                  {isRunning && !currentRun?.output && (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                      <Loader2 size={32} className="animate-spin text-blue-500 mb-3" />
                      <p className="text-sm font-medium text-slate-700">正在执行流程算子计算…</p>
                      <p className="text-xs text-slate-400 mt-1">
                        系统正在处理流转数据并生成各算子输出，请稍候
                      </p>
                    </div>
                  )}

                  {/* Output Display */}
                  {!isRunning && currentRun?.output && (
                    <div>
                      {/* Top Bar for Result Format Toggle */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700">输出内容</span>
                          {outputRows && (
                            <span className="text-xs text-slate-500">
                              (共 {outputRows.length} 行记录)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {outputRows && (
                            <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
                              <button
                                type="button"
                                className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                  resultDisplayMode === "table"
                                    ? "bg-white text-blue-700 shadow-xs"
                                    : "text-slate-600 hover:text-slate-900"
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
                                    ? "bg-white text-blue-700 shadow-xs"
                                    : "text-slate-600 hover:text-slate-900"
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
                            className="h-7 text-xs text-slate-600"
                            onClick={() => handleCopyJson(currentRun.output)}
                          >
                            {copied ? (
                              <Check size={13} className="text-emerald-600 mr-1" />
                            ) : (
                              <Copy size={13} className="mr-1" />
                            )}
                            复制结果
                          </Button>
                        </div>
                      </div>

                      {/* Tabular Data View */}
                      {outputRows && resultDisplayMode === "table" ? (
                        <div className="overflow-x-auto rounded border border-slate-200 max-h-[380px]">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10">
                              <tr>
                                <th className="px-3 py-2 w-12 text-slate-400 font-mono">#</th>
                                {outputColumns.map(col => (
                                  <th key={col} className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {outputRows.map((row: any, rowIndex: number) => (
                                <tr
                                  key={rowIndex}
                                  className="hover:bg-blue-50/40 transition-colors"
                                >
                                  <td className="px-3 py-2 text-slate-400 font-mono text-[11px]">
                                    {rowIndex + 1}
                                  </td>
                                  {outputColumns.map(col => {
                                    const val = typeof row === "object" && row !== null ? row[col] : row;
                                    return (
                                      <td
                                        key={col}
                                        className="px-3 py-2 text-slate-800 whitespace-nowrap max-w-xs truncate"
                                        title={val === null || val === undefined ? "" : typeof val === "object" ? JSON.stringify(val) : String(val)}
                                      >
                                        {val === null || val === undefined ? (
                                          <span className="text-slate-300 italic">null</span>
                                        ) : typeof val === "boolean" ? (
                                          <span className={val ? "text-emerald-600 font-semibold" : "text-slate-400"}>
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
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        /* JSON / Code View */
                        <pre className="max-h-[380px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs font-mono leading-5 text-emerald-300">
                          {JSON.stringify(currentRun.output, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}

                  {!isRunning && !currentRun?.output && !runError && !currentRun?.error && (
                    <div className="py-12 text-center text-xs text-slate-400">
                      本次运行未返回结构化输出，请查看“算子执行明细”。
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Execution Steps / Node Details */}
              {activeTab === "steps" && (
                <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white p-4 shadow-sm min-h-[300px]">
                  <p className="text-xs text-slate-500 mb-3">
                    按照流程拓扑顺序记录各算子的实际执行状态、耗时与输入输出数据：
                  </p>

                  <div className="space-y-2">
                    {/* Dataflow Artifacts / Nodes */}
                    {isDataflow && (currentRun?.nodeRuns?.length ? currentRun.nodeRuns : (dataflowLineageQuery.data?.artifacts || [])).map((item: any, index: number) => {
                      const nodeId = String(item.nodeId);
                      const nodeInfo = nodeNameMap.get(nodeId);
                      const artifact = (dataflowLineageQuery.data?.artifacts || []).find((a: any) => String(a.nodeId) === nodeId);
                      const isExpanded = expandedNodeId === item.id;
                      const isSuccess = item.status === "success" || !item.status;
                      const rowCount = item.rowCount ?? (artifact as any)?.rowCount ?? (Array.isArray(item.output?.rows) ? item.output.rows.length : null);
                      return (
                        <div
                          key={item.id}
                          className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden"
                        >
                          <div
                            className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-slate-100/60 transition-colors"
                            onClick={() => setExpandedNodeId(isExpanded ? null : item.id)}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                                {index + 1}
                              </span>
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  isSuccess ? "bg-emerald-500" : "bg-red-500"
                                }`}
                              />
                              <span className="text-xs font-semibold text-slate-800">
                                {nodeInfo?.name || item.nodeId}
                              </span>
                              <code className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded uppercase">
                                {item.nodeType || nodeInfo?.type}
                              </code>
                            </div>

                            <div className="flex items-center gap-3">
                              {rowCount !== null && rowCount !== undefined && (
                                <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/50">
                                  产出 {rowCount} 行
                                </span>
                              )}
                              {item.durationMs !== undefined && item.durationMs !== null && (
                                <span className="text-xs text-slate-400 font-mono">
                                  {item.durationMs} ms
                                </span>
                              )}
                              {isExpanded ? (
                                <ChevronDown size={15} className="text-slate-400" />
                              ) : (
                                <ChevronRight size={15} className="text-slate-400" />
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-slate-200 bg-white p-3.5 space-y-3">
                              {item.error && (
                                <div className="rounded bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                                  <p className="font-semibold text-red-900 mb-0.5">算子执行失败</p>
                                  <pre className="whitespace-pre-wrap font-mono text-[11px]">
                                    {typeof item.error === "string" ? item.error : item.error?.message || JSON.stringify(item.error)}
                                  </pre>
                                </div>
                              )}
                              {(artifact?.sample?.length || (Array.isArray(item.output?.rows) && item.output.rows.length)) ? (
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-600 mb-1.5">
                                    节点输出数据 (
                                    {artifact?.sample?.length || item.output?.rows?.length} 条)
                                  </p>
                                  <pre className="max-h-40 overflow-auto rounded bg-slate-900 p-2.5 text-[11px] text-emerald-300 font-mono">
                                    {JSON.stringify(artifact?.sample || item.output?.rows, null, 2)}
                                  </pre>
                                </div>
                              ) : item.output ? (
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-600 mb-1.5">节点输出</p>
                                  <pre className="max-h-40 overflow-auto rounded bg-slate-900 p-2.5 text-[11px] text-emerald-300 font-mono">
                                    {JSON.stringify(item.output, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                              {artifact?.schema && artifact.schema.length > 0 && (
                                <div>
                                  <p className="text-[11px] font-semibold text-slate-600 mb-1">字段 Schema</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {artifact.schema.map((f: any, fi: number) => (
                                      <span
                                        key={fi}
                                        className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200"
                                      >
                                        {f.name}: {f.type}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Standard Workflow Node Runs */}
                    {!isDataflow && currentRun?.nodeRuns?.map((node: any, index: number) => {
                      const isExpanded = expandedNodeId === node.id;
                      const isSuccess = node.status === "success";
                      return (
                        <div
                          key={node.id}
                          className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden"
                        >
                          <div
                            className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-slate-100/60 transition-colors"
                            onClick={() => setExpandedNodeId(isExpanded ? null : node.id)}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                                {index + 1}
                              </span>
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  isSuccess ? "bg-emerald-500" : "bg-red-500"
                                }`}
                              />
                              <span className="text-xs font-semibold text-slate-800">
                                {node.nodeName || node.nodeId}
                              </span>
                              <code className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                                {node.nodeType}
                              </code>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="text-xs text-slate-500 font-mono">
                                {node.durationMs ?? 0} ms
                              </span>
                              {isExpanded ? (
                                <ChevronDown size={15} className="text-slate-400" />
                              ) : (
                                <ChevronRight size={15} className="text-slate-400" />
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-slate-200 bg-white p-3.5 grid gap-3 sm:grid-cols-2">
                              <div>
                                <p className="text-[11px] font-semibold text-slate-500 mb-1">节点输入</p>
                                <pre className="max-h-36 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-200">
                                  {JSON.stringify(node.input || {}, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <p className="text-[11px] font-semibold text-slate-500 mb-1">
                                  {node.error ? "节点报错" : "节点输出"}
                                </p>
                                <pre
                                  className={`max-h-36 overflow-auto rounded p-2 text-[10px] ${
                                    node.error
                                      ? "bg-red-950 text-red-200"
                                      : "bg-slate-900 text-emerald-300"
                                  }`}
                                >
                                  {JSON.stringify(node.error || node.output || {}, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {!dataflowLineageQuery.data?.artifacts?.length && !currentRun?.nodeRuns?.length && (
                      <div className="py-8 text-center text-xs text-slate-400">
                        {isRunning ? "正在搜集各节点执行信息…" : "暂无节点执行明细"}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Run Input Parameters */}
              {activeTab === "input" && (
                <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white p-4 shadow-sm min-h-[300px]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-slate-500">本次试运行提交的输入字段：</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-blue-600"
                      onClick={() => setViewMode("config")}
                    >
                      修改参数
                    </Button>
                  </div>

                  {Object.keys(runInput || {}).length > 0 ? (
                    <pre className="max-h-[350px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs font-mono leading-5 text-blue-300">
                      {JSON.stringify(runInput, null, 2)}
                    </pre>
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-400">
                      本次试运行未传入额外自定义输入参数（使用默认配置运行）。
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>{workflow?.name || "当前流程"}</span>
            <span>·</span>
            <span>试运行结果仅供画布实时调试</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
