import { lazy, Suspense, useState } from "react";
import "./workflow-governance.css";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { RunPayloadDetails } from "./RunPayloadDetails";
const RunExecutionCanvas = lazy(() => import("./RunExecutionCanvas"));

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

function FactSection({ run }: { run: any }) {
  const state = run.flowType === "state";
  const items = state ? (run.stateTransitions ?? []) : (run.milestones ?? []);
  if (!state && run.flowType !== "control") return null;
  return (
    <section>
      <h3 className="aiflow-type-section-title font-semibold text-foreground">
        {state ? "状态迁移历史" : "控制流程里程碑"} · {items.length}
      </h3>
      <p className="aiflow-type-body mt-1 text-muted-foreground">
        {state
          ? "以服务端不可变迁移事实为准，不从任务状态反向推断。"
          : "里程碑是不可变执行标记，不改变业务状态或参与人权限。"}
      </p>
      <div className="mt-3 grid gap-2">
        {items.map((item: any) => (
          <article
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 aiflow-type-body"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">
                {state
                  ? `${item.fromStateCode || "流程启动"} → ${item.toStateCode}`
                  : item.displayName}
              </p>
              <p className="mt-1 break-all aiflow-type-meta text-muted-foreground">
                {state
                  ? `#${item.sequenceNo}`
                  : `${item.milestoneCode} · ${item.category}`}
              </p>
            </div>
            <time className="aiflow-type-meta text-muted-foreground">
              {formatTime(state ? item.createdAt : item.occurredAt)}
            </time>
          </article>
        ))}
        {!items.length && (
          <p className="rounded bg-muted p-3 aiflow-type-body text-muted-foreground">
            {state ? "尚无状态迁移事实。" : "尚无里程碑。"}
          </p>
        )}
      </div>
    </section>
  );
}
export function RunDetailContent({ run }: { run: any }) {
  const [selection, setSelection] = useState<{
    runId: string;
    nodeId: string;
    recordId: string;
    version: number;
  } | null>(null);
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
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
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
      <Suspense
        fallback={
          <p
            className="p-4 aiflow-type-body text-muted-foreground"
            role="status"
          >
            正在准备实例流程图…
          </p>
        }
      >
        <RunExecutionCanvas
          key={run.id}
          run={run}
          focusRequest={
            selection && selection.runId === run.id ? selection : undefined
          }
        />
      </Suspense>
      <RunPayloadDetails title="实例错误" value={run.errorJson} kind="error" />
      <FactSection run={run} />
      <section>
        <h3 className="aiflow-type-section-title font-semibold text-foreground">
          操作记录 · {actions.length}
        </h3>
        <p className="aiflow-type-body mt-1 text-muted-foreground">
          按操作时间倒序排列，点击记录在图中查看对应节点与本次办理详情。
        </p>
        <div data-instance-action-list className="mt-3 grid gap-2">
          {actions.map((node: any) => (
            <article
              key={node.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <p className="break-words aiflow-type-body font-medium">
                  {node.nodeName || "未命名操作"} · {statusLabel(node.status)}
                </p>
                <p className="mt-1 aiflow-type-meta text-muted-foreground">
                  {formatTime(operationTime(node))} · {node.durationMs ?? "—"}{" "}
                  ms
                </p>
              </div>
              {node.nodeId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  data-run-record-id={node.id}
                  onClick={() =>
                    setSelection(previous => ({
                      runId: run.id,
                      nodeId: String(node.nodeId),
                      recordId: String(node.id),
                      version: (previous?.version ?? 0) + 1,
                    }))
                  }
                >
                  在图中查看详情
                </Button>
              ) : (
                <details>
                  <summary className="aiflow-type-body">查看旧记录</summary>
                  <RunPayloadDetails
                    title="节点输入"
                    value={node.inputJson}
                    kind="input"
                  />
                  <RunPayloadDetails
                    title="节点输出"
                    value={node.outputJson}
                    kind="output"
                  />
                  <RunPayloadDetails
                    title="节点错误"
                    value={node.errorJson}
                    kind="error"
                  />
                </details>
              )}
            </article>
          ))}
          {!actions.length && (
            <p className="rounded bg-muted p-4 aiflow-type-body text-muted-foreground">
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
      className="gov-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="流程实例详情"
    >
      <section className="gov-modal">
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
