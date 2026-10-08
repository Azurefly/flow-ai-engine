import { Button } from "@/components/ui/button";
import { ChevronDown, Clock3, Flag, Loader2 } from "lucide-react";
import { RunPayloadDetails } from "./RunPayloadDetails";

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
  const labels: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    waiting: "等待中",
    blocked: "已阻塞",
    success: "成功",
    failed: "失败",
    cancelled: "已取消",
    terminated: "已终止",
    skipped: "已跳过",
  };
  return (
    labels[value] ??
    (value === "unknown" ? "未知状态" : `未知状态（原值：${value}）`)
  );
}

function DetailFields({ title, value }: { title: string; value: unknown }) {
  const allRows = flattenInstanceFields(value);
  const rows = allRows.slice(0, 200);
  if (!rows.length) return null;
  return (
    <section className="min-w-0">
      <h4 className="aiflow-type-section-title mb-2 font-semibold text-foreground">
        {title}
      </h4>
      <div className="overflow-hidden rounded-md border border-border">
        <dl className="divide-y divide-border">
          {rows.map((row, index) => (
            <div
              key={`${row.field}-${index}`}
              className="aiflow-type-body grid min-w-0 gap-1 px-3 py-2 sm:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)]"
            >
              <dt className="aiflow-type-meta break-all font-mono text-muted-foreground">
                {row.field}
              </dt>
              <dd className="aiflow-type-body min-w-0 whitespace-pre-wrap break-words text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {allRows.length > rows.length && (
        <p className="aiflow-type-body mt-1 text-muted-foreground">
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
        <Loader2 className="animate-spin text-muted-foreground" size={22} />
      </div>
    );
  const actions = sortInstanceActions(
    run.nodeRuns ?? [],
    run.definitionSnapshotJson
  );
  return (
    <div className="space-y-4 p-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Summary
          label="实例状态"
          value={statusLabel(run.status)}
          secondary={
            run.participantStatusName
              ? `我的办理：${run.participantStatusName}`
              : undefined
          }
        />
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
          value={
            run.flowType === "state"
              ? run.currentStateName || run.currentStateCode || "尚未进入状态"
              : "不适用"
          }
          secondary={
            run.flowType === "state" && run.currentStateName
              ? run.currentStateCode
              : undefined
          }
        />
        <Summary label="状态版本" value={String(run.stateVersion ?? 0)} />
      </section>
      {run.flowType === "control" && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="aiflow-type-section-title font-semibold text-foreground">
                控制流程里程碑
              </h3>
              <p className="aiflow-type-body mt-1 text-muted-foreground">
                里程碑是不可变执行标记，不会改变业务状态或参与人权限。
              </p>
            </div>
            <span className="aiflow-type-meta rounded-full bg-teal-50 px-2.5 py-1 text-teal-700">
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
                    <p className="aiflow-type-body break-words font-semibold text-foreground">
                      {milestone.displayName}
                    </p>
                    <p className="aiflow-type-meta mt-0.5 break-all font-mono text-teal-700">
                      {milestone.milestoneCode} · {milestone.category}
                    </p>
                    <p className="aiflow-type-meta mt-1 text-muted-foreground">
                      {formatTime(milestone.occurredAt)}
                    </p>
                  </div>
                </div>
              </article>
            ))}
            {!(run.milestones ?? []).length && (
              <p className="aiflow-type-body rounded-lg border border-dashed border-border p-4 text-center text-muted-foreground sm:col-span-2 xl:col-span-3">
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
              <h3 className="aiflow-type-section-title font-semibold text-foreground">
                状态迁移历史
              </h3>
              <p className="aiflow-type-body mt-1 text-muted-foreground">
                以服务端不可变迁移事实为准，不从任务状态反向推断。
              </p>
            </div>
            <span className="aiflow-type-meta rounded-full bg-aiflow-info-surface px-2.5 py-1 text-aiflow-info">
              {(run.stateTransitions ?? []).length} 次迁移
            </span>
          </div>
          <div className="grid gap-2">
            {(run.stateTransitions ?? []).map((transition: any) => (
              <article
                key={transition.id}
                className="grid min-w-0 gap-2 rounded-lg border border-border bg-muted p-3 sm:grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_150px] sm:items-center"
              >
                <span className="aiflow-type-meta font-mono font-semibold text-aiflow-info">
                  #{transition.sequenceNo}
                </span>
                <span className="aiflow-type-body min-w-0 break-words text-muted-foreground">
                  {transition.fromStateCode || "流程启动"}
                </span>
                <span className="aiflow-type-body min-w-0 break-words font-semibold text-foreground">
                  → {transition.toStateCode}
                </span>
                <span className="aiflow-type-meta text-muted-foreground">
                  {formatTime(transition.createdAt)}
                </span>
              </article>
            ))}
            {!(run.stateTransitions ?? []).length && (
              <p className="aiflow-type-body rounded-lg border border-dashed border-border p-4 text-center text-muted-foreground">
                当前实例尚未写入状态迁移事实。
              </p>
            )}
          </div>
        </section>
      )}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="aiflow-type-section-title font-semibold text-foreground">
              操作记录
            </h3>
            <p className="aiflow-type-body mt-1 text-muted-foreground">
              默认仅展示必要字段，并按操作时间倒序排列。
            </p>
          </div>
          <span className="aiflow-type-meta rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            {actions.length} 条
          </span>
        </div>
        <div data-instance-action-list className="grid gap-2">
          {actions.map((node: any) => (
            <article
              key={node.id}
              className="min-w-0 rounded-lg border border-border bg-card shadow-sm"
            >
              <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-[150px_minmax(0,1fr)_90px_90px] sm:items-center">
                <div className="aiflow-type-meta flex min-w-0 items-center gap-2 text-muted-foreground">
                  <Clock3 size={13} className="shrink-0" />
                  <span className="break-words">
                    {formatTime(operationTime(node))}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="aiflow-type-body break-words font-medium text-foreground">
                    {node.nodeName || "未命名操作"}
                  </p>
                  <p className="aiflow-type-meta mt-0.5 break-all font-mono text-muted-foreground">
                    {node.nodeType || "unknown"}
                  </p>
                </div>
                <span
                  className={`aiflow-type-meta w-fit rounded-full px-2 py-1 ${node.status === "success" ? "bg-aiflow-success-surface text-aiflow-success" : node.status === "failed" ? "bg-aiflow-danger-surface text-aiflow-danger" : "bg-aiflow-warning-surface text-aiflow-warning"}`}
                >
                  {statusLabel(node.status)}
                </span>
                <span className="aiflow-type-meta text-muted-foreground">
                  {node.durationMs ?? "—"} ms
                </span>
              </div>
              <details className="group border-t border-border">
                <summary className="aiflow-type-control flex cursor-pointer list-none items-center justify-center gap-1 px-3 py-2 font-medium text-aiflow-info hover:bg-aiflow-info-surface">
                  查看详情
                  <ChevronDown
                    size={13}
                    className="transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="grid min-w-0 gap-4 border-t border-border bg-muted/60 p-3">
                  <RunPayloadDetails
                    title="节点输入"
                    value={node.inputJson}
                    kind="input"
                  />
                  <RunPayloadDetails
                    title="节点输出"
                    value={node.outputJson}
                    kind="output"
                    nodeType={node.nodeType}
                  />
                  <RunPayloadDetails
                    title="节点错误"
                    value={node.errorJson}
                    kind="error"
                  />
                  <details className="overflow-hidden rounded-md border border-border bg-card">
                    <summary className="aiflow-type-control flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                      节点技术信息（内部标识与时间）
                      <span className="aiflow-type-meta font-normal text-muted-foreground">
                        展开
                      </span>
                    </summary>
                    <div className="border-t border-border p-2">
                      <DetailFields
                        title="节点技术信息"
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
                </div>
              </details>
            </article>
          ))}
          {!actions.length && (
            <p className="aiflow-type-body rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
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
  if (!definition || typeof definition !== "object")
    return new Map<string, number>();
  const nodes = (definition as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return new Map<string, number>();
  return new Map(
    nodes.flatMap((node, index) => {
      if (!node || typeof node !== "object" || !("id" in node)) return [];
      return [[String((node as { id: unknown }).id), index] as const];
    })
  );
}

export function sortInstanceActions(
  actions: any[],
  definitionSnapshot?: unknown
) {
  const nodeOrder = definitionNodeOrder(definitionSnapshot);
  return actions
    .map((action, originalIndex) => ({ action, originalIndex }))
    .sort((left, right) => {
      const timeDifference =
        operationTimestamp(right.action) - operationTimestamp(left.action);
      if (timeDifference) return timeDifference;

      const leftSequence = Number(left.action.sequenceNo);
      const rightSequence = Number(right.action.sequenceNo);
      const leftHasSequence =
        Number.isInteger(leftSequence) && leftSequence > 0;
      const rightHasSequence =
        Number.isInteger(rightSequence) && rightSequence > 0;
      if (leftHasSequence && rightHasSequence)
        return rightSequence - leftSequence;
      if (leftHasSequence !== rightHasSequence) return leftHasSequence ? -1 : 1;

      const leftDefinitionOrder = nodeOrder.get(String(left.action.nodeId));
      const rightDefinitionOrder = nodeOrder.get(String(right.action.nodeId));
      if (
        leftDefinitionOrder !== undefined &&
        rightDefinitionOrder !== undefined &&
        leftDefinitionOrder !== rightDefinitionOrder
      ) {
        return rightDefinitionOrder - leftDefinitionOrder;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ action }) => action);
}

function Summary({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted p-3">
      <p className="aiflow-type-meta font-medium text-muted-foreground">
        {label}
      </p>
      <p className="aiflow-type-body mt-1 break-words font-semibold text-foreground">
        {value}
      </p>
      {secondary && (
        <p className="aiflow-type-code mt-1 break-all font-mono text-muted-foreground">
          {secondary}
        </p>
      )}
    </div>
  );
}

export function RunDetailDialog({
  run,
  onClose,
}: {
  run: any;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="流程实例详情"
    >
      <section className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-card shadow-2xl">
        <header className="flex items-start justify-between border-b border-border p-5">
          <div className="min-w-0">
            <p className="aiflow-type-meta font-bold tracking-[.18em] text-aiflow-info">
              PROCESS INSTANCE
            </p>
            <h3 className="aiflow-type-section-title mt-1 font-semibold text-foreground">
              实例详情
            </h3>
            <p className="aiflow-type-meta mt-1 break-all font-mono text-muted-foreground">
              {run?.id ?? "正在读取…"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </header>
        <RunDetailContent run={run} />
      </section>
    </div>
  );
}
