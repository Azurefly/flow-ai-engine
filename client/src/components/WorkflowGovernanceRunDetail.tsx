import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronDown, Clock3, Flag, Loader2, RotateCcw } from "lucide-react";

function parse(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatTime(value: unknown) {
  return value
    ? new Date(String(value)).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function operationTime(node: any) {
  return (
    node.finishedAt ??
    node.updatedAt ??
    node.startedAt ??
    node.createdAt ??
    null
  );
}

export function flattenInstanceFields(
  value: unknown,
  prefix = "",
  depth = 0
): Array<{ field: string; value: string }> {
  const parsed = parse(value);
  if (parsed === null || parsed === undefined) return [];
  if (depth > 5)
    return [{ field: prefix || "值", value: "层级过深，请查看来源记录" }];
  if (Array.isArray(parsed))
    return parsed.flatMap((item, index) =>
      flattenInstanceFields(item, `${prefix || "列表"}[${index}]`, depth + 1)
    );
  if (typeof parsed === "object")
    return Object.entries(parsed as Record<string, unknown>).flatMap(
      ([key, item]) =>
        flattenInstanceFields(
          item,
          prefix ? `${prefix}.${key}` : key,
          depth + 1
        )
    );
  return [{ field: prefix || "值", value: String(parsed) }];
}

function statusLabel(status: unknown) {
  const value = String(status || "unknown");
  return value === "success"
    ? "成功"
    : value === "failed"
      ? "失败"
      : value === "waiting"
        ? "等待处理"
        : value === "running"
          ? "执行中"
          : value === "skipped"
            ? "已跳过"
            : value;
}

function DetailFields({ title, value }: { title: string; value: unknown }) {
  const allRows = flattenInstanceFields(value);
  const rows = allRows.slice(0, 200);
  if (!rows.length) return null;
  return (
    <section className="min-w-0">
      <h4 className="mb-2 text-xs font-semibold text-slate-700">{title}</h4>
      <div className="overflow-hidden rounded-md border border-slate-200">
        <dl className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <div
              key={`${row.field}-${index}`}
              className="grid min-w-0 gap-1 px-3 py-2 text-xs sm:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)]"
            >
              <dt className="break-all font-mono text-slate-500">
                {row.field}
              </dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-slate-700">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {allRows.length > rows.length && (
        <p className="mt-1 text-[10px] text-slate-400">
          字段较多，仅展示前 {rows.length} 项。
        </p>
      )}
    </section>
  );
}

export function RunDetailContent({ run }: { run: any }) {
  if (!run)
    return (
      <div className="grid min-h-48 place-items-center">
        <Loader2 className="animate-spin text-slate-400" size={22} />
      </div>
    );
  const actions = sortInstanceActions(run.nodeRuns ?? [], run.definitionSnapshotJson);
  return (
    <div className="space-y-4 p-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Summary label="实例状态" value={statusLabel(run.status)} />
        <Summary
          label="发起人"
          value={
            run.triggeredByName ||
            run.username ||
            `用户 ${run.triggeredByUserId ?? "—"}`
          }
        />
        <Summary
          label="开始时间"
          value={formatTime(run.startedAt ?? run.createdAt)}
        />
        <Summary label="结束时间" value={formatTime(run.finishedAt)} />
        <Summary
          label="当前业务状态"
          value={run.currentStateCode || (run.flowType === "state" ? "尚未进入状态" : "不适用")}
        />
        <Summary label="状态版本" value={String(run.stateVersion ?? 0)} />
      </section>
      {run.flowType === "control" && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">控制流程里程碑</h3>
              <p className="mt-1 text-xs text-slate-500">
                里程碑是不可变执行标记，不会改变业务状态或参与人权限。
              </p>
            </div>
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[10px] text-teal-700">
              {(run.milestones ?? []).length} 个
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {(run.milestones ?? []).map((milestone: any) => (
              <article
                key={milestone.id}
                className="min-w-0 rounded-lg border border-teal-100 bg-teal-50/50 p-3"
              >
                <div className="flex items-start gap-2">
                  <Flag size={14} className="mt-0.5 shrink-0 text-teal-700" />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-800">
                      {milestone.displayName}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[10px] text-teal-700">
                      {milestone.milestoneCode} · {milestone.category}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {formatTime(milestone.occurredAt)}
                    </p>
                  </div>
                </div>
              </article>
            ))}
            {!(run.milestones ?? []).length && (
              <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 sm:col-span-2 xl:col-span-3">
                当前控制流程尚未产生里程碑。
              </p>
            )}
          </div>
        </section>
      )}
      {run.flowType === "state" && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">状态迁移历史</h3>
              <p className="mt-1 text-xs text-slate-500">
                以服务端不可变迁移事实为准，不从任务状态反向推断。
              </p>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] text-blue-700">
              {(run.stateTransitions ?? []).length} 次迁移
            </span>
          </div>
          <div className="grid gap-2">
            {(run.stateTransitions ?? []).map((transition: any) => (
              <article
                key={transition.id}
                className="grid min-w-0 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_150px] sm:items-center"
              >
                <span className="font-mono font-semibold text-blue-700">
                  #{transition.sequenceNo}
                </span>
                <span className="min-w-0 break-words text-slate-500">
                  {transition.fromStateCode || "流程启动"}
                </span>
                <span className="min-w-0 break-words font-semibold text-slate-800">
                  → {transition.toStateCode}
                </span>
                <span className="text-slate-500">
                  {formatTime(transition.createdAt)}
                </span>
              </article>
            ))}
            {!(run.stateTransitions ?? []).length && (
              <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                当前实例尚未写入状态迁移事实。
              </p>
            )}
          </div>
        </section>
      )}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">操作记录</h3>
            <p className="mt-1 text-xs text-slate-500">
              默认仅展示必要字段，并按操作时间倒序排列。
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] text-slate-500">
            {actions.length} 条
          </span>
        </div>
        <div data-instance-action-list className="grid gap-2">
          {actions.map((node: any) => (
            <article
              key={node.id}
              className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm"
            >
              <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-[150px_minmax(0,1fr)_90px_90px] sm:items-center">
                <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
                  <Clock3 size={13} className="shrink-0" />
                  <span className="break-words">
                    {formatTime(operationTime(node))}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-slate-800">
                    {node.nodeName || "未命名操作"}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-[10px] text-slate-400">
                    {node.nodeType || "unknown"} ·{" "}
                    {String(node.nodeId || node.id).slice(0, 24)}
                  </p>
                </div>
                <span
                  className={`w-fit rounded-full px-2 py-1 text-[10px] ${node.status === "success" ? "bg-emerald-100 text-emerald-700" : node.status === "failed" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}
                >
                  {statusLabel(node.status)}
                </span>
                <span className="text-xs text-slate-500">
                  {node.durationMs ?? "—"} ms
                </span>
              </div>
              <details className="group border-t border-slate-100">
                <summary className="flex cursor-pointer list-none items-center justify-center gap-1 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50">
                  查看详情
                  <ChevronDown
                    size={13}
                    className="transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="grid min-w-0 gap-4 border-t border-slate-100 bg-slate-50/60 p-3">
                  <DetailFields title="输入字段" value={node.inputJson} />
                  <DetailFields title="输出字段" value={node.outputJson} />
                  <DetailFields title="错误字段" value={node.errorJson} />
                  <DetailFields
                    title="其余字段"
                    value={{
                      id: node.id,
                      runId: node.runId,
                      nodeId: node.nodeId,
                      nodeType: node.nodeType,
                      status: node.status,
                      startedAt: node.startedAt,
                      finishedAt: node.finishedAt,
                      createdAt: node.createdAt,
                      sequenceNo: node.sequenceNo,
                      durationMs: node.durationMs,
                    }}
                  />
                </div>
              </details>
            </article>
          ))}
          {!actions.length && (
            <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              该实例尚无节点操作记录。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function operationTimestamp(node: any) {
  const timestamp = new Date(operationTime(node) ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function definitionNodeOrder(definitionSnapshot: unknown) {
  const definition = parse(definitionSnapshot);
  if (!definition || typeof definition !== "object") return new Map<string, number>();
  const nodes = (definition as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return new Map<string, number>();
  return new Map(nodes.flatMap((node, index) => {
    if (!node || typeof node !== "object" || !("id" in node)) return [];
    return [[String((node as { id: unknown }).id), index] as const];
  }));
}

export function sortInstanceActions(actions: any[], definitionSnapshot?: unknown) {
  const nodeOrder = definitionNodeOrder(definitionSnapshot);
  return actions
    .map((action, originalIndex) => ({ action, originalIndex }))
    .sort((left, right) => {
      const timeDifference = operationTimestamp(right.action) - operationTimestamp(left.action);
      if (timeDifference) return timeDifference;

      const leftSequence = Number(left.action.sequenceNo);
      const rightSequence = Number(right.action.sequenceNo);
      const leftHasSequence = Number.isInteger(leftSequence) && leftSequence > 0;
      const rightHasSequence = Number.isInteger(rightSequence) && rightSequence > 0;
      if (leftHasSequence && rightHasSequence) return rightSequence - leftSequence;
      if (leftHasSequence !== rightHasSequence) return leftHasSequence ? -1 : 1;

      const leftDefinitionOrder = nodeOrder.get(String(left.action.nodeId));
      const rightDefinitionOrder = nodeOrder.get(String(right.action.nodeId));
      if (leftDefinitionOrder !== undefined && rightDefinitionOrder !== undefined && leftDefinitionOrder !== rightDefinitionOrder) {
        return rightDefinitionOrder - leftDefinitionOrder;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ action }) => action);
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-medium text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-700">
        {value}
      </p>
    </div>
  );
}

export function RunDetailDialog({
  run,
  isLoading = false,
  error = null,
  retrying = false,
  onRetry,
  onClose,
}: {
  run: any;
  isLoading?: boolean;
  error?: unknown;
  retrying?: boolean;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const errorMessage = error instanceof Error ? error.message : "暂时无法读取该流程实例，请稍后重试。";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="流程实例详情"
    >
      <section className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-100 p-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[.18em] text-blue-600">
              PROCESS INSTANCE
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">
              实例详情
            </h3>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">
              {run?.id ?? "正在读取…"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </header>
        {isLoading ? (
          <div className="grid min-h-48 place-items-center gap-2 p-5 text-center" role="status" aria-live="polite">
            <Loader2 className="animate-spin text-slate-400" size={22} />
            <p className="text-sm text-slate-500">正在读取流程实例详情…</p>
          </div>
        ) : error ? (
          <div className="grid min-h-48 place-items-center gap-3 p-5 text-center" role="alert">
            <AlertTriangle className="text-red-500" size={24} />
            <div>
              <p className="text-sm font-medium text-slate-700">流程实例详情读取失败</p>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">{errorMessage}</p>
            </div>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
                {retrying && <Loader2 className="animate-spin" size={14} />}
                {!retrying && <RotateCcw size={14} />}
                重试
              </Button>
            )}
          </div>
        ) : run ? (
          <RunDetailContent run={run} />
        ) : (
          <div className="grid min-h-48 place-items-center p-5 text-sm text-slate-500" role="status">
            未找到该流程实例详情。
          </div>
        )}
      </section>
    </div>
  );
}
