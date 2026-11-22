import { DurableRunLinks } from "./DurableRunLinks";
const surfaceClass1 = "aiflow-type-body text-muted-foreground";
import "./run-execution-canvas.css";
import { CanvasConnectionEdge } from "./CanvasConnectionEdge";
import { canvasNodeRects, readableCanvasLayout, canvasContextIds, canvasViewBounds, canvasHasCrowding } from "@shared/workflow-canvas-geometry";
import { useMemo, useState, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  getViewportForBounds,
  useStore,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  projectRunGraph,
  resolveRunGraphFocus,
  resolveRunGraphRecord,
  runNodeLabels,
  type RunRecord,
  type RunGraphNode,
} from "@shared/run-execution-graph";
import { RunPayloadDetails } from "./RunPayloadDetails";
import { nodeExecutionEntries } from "@shared/node-execution-entries";
import { formatRunDuration } from "@shared/run-duration";
import { RunApprovalProgress } from "./RunApprovalProgress";
import { approvalGroupsForRecord } from "@shared/run-approval-progress";
import { initialRunViewNode, runGraphFitOptions, runGraphHandles } from "@shared/run-graph-viewport";
import { workflowNodeTypeLabel } from "@shared/workflow-node-label";
import { Button } from "./ui/button";
type ViewerNode = Node<
  { item: RunGraphNode; choose: (id: string) => void; selected: boolean },
  "runNode"
>;
function modelEvidence(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

// Tailwind keeps these complete tokens while equivalent status classes share one factory.
// border-aiflow-success-border bg-aiflow-success-surface text-aiflow-success
// border-aiflow-danger-border bg-aiflow-danger-surface text-aiflow-danger
// border-aiflow-info-border bg-aiflow-info-surface text-aiflow-info
// border-aiflow-warning-border bg-aiflow-warning-surface text-aiflow-warning
const tone = (name: string) => `border-aiflow-${name}-border bg-aiflow-${name}-surface text-aiflow-${name}`;
const inactiveColor = "border-border bg-muted text-muted-foreground";
const selectClass = "h-11 min-w-0 rounded border border-border bg-card px-2";
const colors: Record<string, string> = {
  idle: "border-border bg-card text-muted-foreground",
  success: tone("success"),
  failed: tone("danger"),
  running: tone("info"),
  waiting: tone("warning"),
  skipped: inactiveColor,
  stopped: inactiveColor,
  cancelled: inactiveColor,
};
function RunNode({ data }: NodeProps<ViewerNode>) {
  const item = data.item as RunRecord;
  const compact = useStore(state => state.transform[2] < 0.72);
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <button
        type="button"
        onClick={() => (data.choose as (id: string) => void)(item.id)}
        aria-label={`${item.name}，${item.status === "waiting" && item.type === "operate" ? "待办理" : runNodeLabels[item.status]}，${item.records.length}次执行`}
        data-run-node=""
        data-compact={compact ? "true" : undefined}
        title={item.name}
        className={`run-graph-node ${colors[item.status]} ${data.selected ? "is-selected" : ""}`}
      >
        <span className="run-graph-node-title">
          {item.name}
        </span>
        <span data-run-node-status={item.status} className={`run-graph-node-status ${colors[item.status]}`} title={runNodeLabels[item.status]}>
          <span>{runNodeLabels[item.status]}</span>
        </span>
        <span className="run-graph-node-count">
          {item.records.length
            ? `${item.records.length} 次执行${item.activeCount ? ` · ${item.activeCount} 处等待` : ""}`
            : "尚未到达"}
        </span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
    </>
  );
}
const nodeTypes = { runNode: RunNode };
const edgeTypes = { runEdge: CanvasConnectionEdge };
const overviewFit = runGraphFitOptions();
function ViewportMeasurement({ onReady }: { onReady: (ready: boolean) => void }) {
  const initialized = useNodesInitialized();
  useEffect(() => onReady(initialized), [initialized, onReady]);
  return null;
}
export default function RunExecutionCanvas({
  run,
  focusRequest,
  entryTaskId,
  renderDataOutput,
  workspace = false,
}: {
  run: RunRecord;
  focusRequest?: { nodeId: string; recordId: string; version: number };
  entryTaskId?: string;
  renderDataOutput?: (record: RunRecord) => React.ReactNode;
  workspace?: boolean;
}) {
  const graph = useMemo(() => projectRunGraph(run), [run]);
  const initialFocus = useMemo(
    () => resolveRunGraphFocus(run, graph.nodes, entryTaskId),
    [run, graph, entryTaskId]
  );
  const [selected, setSelected] = useState(() =>
    workspace && entryTaskId && initialFocus.recordId ? initialFocus.nodeId ?? "" : ""
  );
  const [occurrence, setOccurrence] = useState("");
  const chosenRecords = useRef(new Map<string, string>());
  const [layout, setLayout] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const hasTrace = graph.edges.some(edge => edge.traversed);
  const [routeView, setRouteView] = useState(workspace && hasTrace && !entryTaskId && !focusRequest);
  const [motionPaused, setMotionPaused] = useState(false);
  const routeOnly = layout && routeView && hasTrace;
  const visibleEdges = routeOnly ? graph.edges.filter(edge => edge.traversed) : graph.edges;
  const api = useRef<ReactFlowInstance<ViewerNode, Edge> | null>(null);
  const [ready, setReady] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [sizes, setSizes] = useState(new Map<string, { width: number; height: number }>());
  // Selecting a default detail record must not hide the rest of the instance.
  const [initialFit] = useState(() => runGraphFitOptions(initialRunViewNode(focusRequest?.nodeId, entryTaskId ? initialFocus.nodeId : undefined)));
  const overview = useRef(!initialFit.nodes?.length);
  const viewport = useRef<HTMLDivElement | null>(null);
  const viewNodes = useRef<ViewerNode[]>([]);
  const viewEdges = useRef<Edge[]>([]);
  const fit = (nodeId?: string) => {
    overview.current = !nodeId;
    const region = viewport.current;
    // UX：隐藏的阅读面板没有可用尺寸，恢复可见后再由ResizeObserver适配。
    if (!api.current || !region || !region.clientWidth || !region.clientHeight) return;
    const rects = canvasNodeRects(viewNodes.current);
    const next = getViewportForBounds(canvasViewBounds(rects, viewEdges.current, canvasContextIds(rects, viewEdges.current, nodeId)), region.clientWidth, region.clientHeight, 0.01, 1, 0.18);
    void api.current.setViewport(next, { duration: 0 });
  };
  const showRunView = (route: boolean) => {
    if (routeOnly === route) return fit();
    overview.current = true;
    setRouteView(route);
    if (route) {
      setLayout(true);
      if (!active?.records.length) setSelected("");
    }
  };
  const current = graph.nodes.filter(n =>
    ["running", "waiting", "failed"].includes(n.status)
  );
  const active =
    graph.nodes.find(n => n.id === selected) ??
    graph.nodes.find(n => n.id === initialFocus.nodeId);
  const record = resolveRunGraphRecord(active, initialFocus, occurrence);
  const modelTrace = active?.type === "llm" && record ?
    modelEvidence(modelEvidence(record.errorJson).modelTrace ?? record.outputJson) : null;
  const pending =
    record && ["waiting", "running", "pending"].includes(record.status);
  const choose = (id: string, recordId?: string) => {
    fit(id);
    if (id === active?.id && !recordId && (!workspace || selected)) return;
    if (id !== active?.id && active && record) chosenRecords.current.set(active.id, record.id);
    setSelected(id);
    setOccurrence(recordId ?? (id === active?.id ? occurrence : chosenRecords.current.get(id) ?? ""));
  };
  const executionEntries = useMemo(
    () => workspace && Array.isArray(run.nodeRuns) ? nodeExecutionEntries<RunRecord>(run.nodeRuns) : [],
    [workspace, run.nodeRuns]
  );
  const recordsScroll = useRef<HTMLDivElement>(null);
  const activeRecordButton = useRef<HTMLButtonElement>(null);
  const activeRecordId = selected ? record?.id : undefined;
  useEffect(() => {
    const scroller = recordsScroll.current;
    const button = activeRecordButton.current;
    if (!workspace || !activeRecordId || !scroller || !button) return;
    const bounds = scroller.getBoundingClientRect();
    const row = button.getBoundingClientRect();
    if (row.top < bounds.top) scroller.scrollTop += row.top - bounds.top - 8;
    else if (row.bottom > bounds.bottom) scroller.scrollTop += row.bottom - bounds.bottom + 8;
  }, [workspace, activeRecordId]);
  const rawNodes: ViewerNode[] = (routeOnly ? graph.nodes.filter(node => node.records.length) : graph.nodes).map(n => ({
    id: n.id,
    type: "runNode",
    position: layout ? n.layout : n.position,
    data: { item: n, choose, selected: active?.id === n.id },
    draggable: false,
    connectable: false,
    measured: sizes.get(n.id),
    handles: runGraphHandles(sizes.get(n.id) ?? { width: 208, height: 104 }),
  }));
  // UX: measured reading geometry is shared with the designer; original snapshot stays intact.
  const nodes = layout ? readableCanvasLayout(rawNodes, visibleEdges.map(e => ({ source: String(e.source), target: String(e.target), data: { loop: e.returning } }))) : rawNodes;
  const rects = canvasNodeRects(nodes);
  viewNodes.current = nodes;
  const edges: Edge[] = visibleEdges.map((e, canvasLane) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "runEdge",
    className: e.traversed ? "run-edge-traversed" : undefined,
    zIndex: e.traversed ? 1 : 0,
    data: { canvasRects: rects, canvasLane, loop: e.returning, canvasEmphasis: e.traversed, canvasFlow: e.traversed, canvasStroke: e.traversed ? "var(--aiflow-canvas-selected)" : undefined },
    label: e.label
      ? `${e.returning ? "返回 · " : ""}${e.label}${e.confirmed ? ` · 已选${e.confirmed}次` : ""}`
      : undefined,

  }));
  viewEdges.current = edges;
  const nodeActivities = (run.taskActivities ?? []).filter(
    (t: RunRecord) => t.nodeId === active?.id
  );
  const legacyAmbiguous =
    active &&
    active.records.length > 1 &&
    nodeActivities.some((t: RunRecord) => !t.nodeRunId);
  const activities = nodeActivities.filter((t: RunRecord) =>
    t.nodeRunId ? t.nodeRunId === record?.id : active?.records.length === 1
  );
  const approvalGroups = record ? approvalGroupsForRecord(run.approvalGroups ?? [], record) : [];
  const focusId = useRef(active?.id);
  focusId.current = active?.id;
  const fittedBox = useRef("");
  useEffect(() => {
    if (!ready || !measured) return;
    const region = viewport.current;
    if (!region) return;
    // UX：隐藏/恢复不改实际阅读尺寸时，保留用户缩放与平移。
    const resize = () => {
      const key = [region.clientWidth, region.clientHeight, layout, expanded, routeOnly].join(":");
      if (!region.clientWidth || !region.clientHeight || fittedBox.current === key) return;
      fittedBox.current = key;
      fit(overview.current ? undefined : focusId.current);
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(region);
    return () => observer.disconnect();
  }, [layout, ready, measured, expanded, routeOnly]);
  const root = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusRequest) {
      setSelected(focusRequest.nodeId);
      setOccurrence(focusRequest.recordId);
      if (ready && measured) {
        fit(focusRequest.nodeId);
        root.current?.scrollIntoView({ block: "start", behavior: "auto" });
      }
    }
  }, [focusRequest, ready, measured]);
  const focus = () => {
    if (active) fit(active.id);
  };
  const graphNodesById = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph.nodes]);
  const activeDetails = active && (
    <div className="mt-4 space-y-4">
      <p className="break-words aiflow-type-section-title font-semibold text-foreground">
        {active.name}
      </p>
      {!workspace && active.records.length > 1 && (
        <label className="grid gap-1 aiflow-type-body">
          执行批次
          <select
            aria-label="查看执行批次"
            className={selectClass}
            value={record?.id ?? ""}
            onChange={e => setOccurrence(e.target.value)}
          >
            {!record && (
              <option value="" disabled>
                请选择需要核对的执行批次
              </option>
            )}
            {active.records.map((r: RunRecord, i: number) => (
              <option key={r.id} value={r.id}>
                第{i + 1}次 · {runNodeLabels[r.status] ?? r.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {!record ? (
        <p className={surfaceClass1}>
          {active.records.length
            ? "请选择执行批次后查看本次办理。"
            : "此节点尚未执行。"}
        </p>
      ) : (
        <>
          <p className={surfaceClass1}>
            本次：{runNodeLabels[record.status] ?? record.status} · 耗时{" "}
            {record.durationMs ?? "—"} ms
          </p>
          {modelTrace && <dl className="grid grid-cols-[auto_1fr] gap-x-3 break-all text-sm" aria-label="模型调用记录">
            <dt>请求模型</dt><dd>{String(modelTrace.requestedModel ?? "当时未记录")}</dd>
            <dt>返回模型</dt><dd>{String(modelTrace.reportedModel ?? ("reportedModel" in modelTrace ? "供应商未返回" : "当时未记录"))}</dd>
            <dt>配置修订</dt><dd>{String(modelTrace.configurationRevision ?? "当时未记录")}</dd>
            <dt>响应标识</dt><dd>{String(modelTrace.providerCompletionId ?? "当时未记录")}</dd>
          </dl>}
          {run.flowType === "data" && <p className="aiflow-type-body break-words text-muted-foreground">
            {workflowNodeTypeLabel(active.type)} · {active.id} · 输出 {record.rowCount ?? "—"} 行 · {record.attempt ? `第 ${record.attempt} 次尝试` : "未记录尝试次数"}
          </p>}
          {legacyAmbiguous && (
            <p
              role="status"
              className="rounded bg-muted p-2 aiflow-type-body"
            >
              旧任务缺少批次标识，办理人请核对操作记录。
            </p>
          )}
          {approvalGroups.map(group => <RunApprovalProgress key={group.groupId} group={group} />)}
          {!approvalGroups.length && activities.map((t: RunRecord) => (
            <div
              key={t.id}
              className="rounded border border-border p-2 aiflow-type-body"
            >
              <p>
                {t.status === "completed"
                  ? "实际办理人"
                  : t.status === "cancelled"
                    ? "原处理人"
                    : "当前处理人"}
                ：
                {t.completedByName ||
                  t.claimedByName ||
                  t.assignedName ||
                  (t.candidateCount
                    ? `${t.candidateCount}名候选待签收`
                    : "未分派")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {t.status === "completed"
                  ? "已完成"
                  : t.status === "claimed"
                    ? "办理中"
                    : t.status === "cancelled"
                      ? "已取消"
                      : "待办理"}
              </p>
            </div>
          ))}
          {renderDataOutput ? renderDataOutput(record) : !pending && (
            <RunPayloadDetails
              title="本次办理结果"
              value={record.outputJson}
              kind="output"
              nodeType={active.type}
              nodeConfig={active.config}
            />
          )}
          <RunPayloadDetails
            title="错误原因"
            value={record.errorJson}
            kind="error"
          />
          <details>
            <summary className="cursor-pointer aiflow-type-body text-muted-foreground">
              查看输入、输出及记录信息
            </summary>
            <div className="mt-3">
              {pending && (
                <RunPayloadDetails
                  title="节点输出"
                  value={record.outputJson}
                  kind="output"
                  nodeType={active.type}
                />
              )}
              <RunPayloadDetails
                title="本次输入"
                value={record.inputJson}
                kind="input"
              />
              <div className="mt-2 break-all aiflow-type-meta text-muted-foreground">
                <RunPayloadDetails
                  title="记录信息"
                  value={record}
                  kind="input"
                />
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
  return (
    <section
      ref={root}
      data-run-execution-graph
      data-run-canvas-design=""
      data-run-canvas-workspace={workspace ? "" : undefined}
      data-run-has-trace={hasTrace ? "" : undefined}
      data-run-route-view={routeOnly ? "" : undefined}
      data-run-motion-paused={motionPaused ? "" : undefined}
      className="run-graph"
    >
      {!workspace && run.childLinks?.length > 0 && <DurableRunLinks links={run.childLinks} runId={String(run.id)} />}
      <header className="run-graph-header">
        <div>
          <h3>
            实例流程图
          </h3>
          <p>
            {graph.hasSnapshot ? "基于本次运行快照" : "仅有节点执行记录"} · {routeOnly && "已到达 "}{nodes.length} 个节点 ·{" "}
            {current.filter(n => n.activeCount).length} 处进行中
          </p>
        </div>
        <div data-run-canvas-actions="" className="flex flex-wrap gap-2">
          {hasTrace && <Button variant="outline" size="sm" aria-pressed={routeOnly} onClick={() => showRunView(true)}>执行路线</Button>}
          <Button
            variant="outline"
            size="sm"
            aria-pressed={hasTrace ? !routeOnly : undefined}
            disabled={!ready || !measured}
            onClick={() => showRunView(false)}
          >
            查看全图
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || !measured || !active}
            onClick={focus}
          >
            定位选中节点
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!graph.hasOriginalLayout}
            onClick={() => { setRouteView(false); setLayout(x => !x); }}
          >
            {layout ? "原始布局" : "自动排布"}
          </Button>
          {hasTrace && <Button variant="outline" size="sm" data-run-motion-toggle="" onClick={() => setMotionPaused(paused => !paused)}>
            {motionPaused ? "播放动效" : "暂停动效"}
          </Button>}
          {!workspace && <Button
            variant="outline"
            size="sm"
            aria-pressed={expanded}
            onClick={() => setExpanded(x => !x)}
          >
            {expanded ? "收起画布" : "展开画布"}
          </Button>}
        </div>
        {/* 阅读说明与视图操作归入同一工具区，画布直接接续工具栏。 */}
        <details data-run-legend="">
          <summary>图例与阅读说明</summary>
        <div className="run-graph-legend-items">
          {Object.entries(runNodeLabels).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1">
              <i className={`h-3 w-3 rounded border ${colors[key]}`} />
              {label}
            </span>
          ))}
          <span>{run.flowType === "data" ? "灰线表示快照依赖，节点颜色表示执行状态。" : "蓝色粗线表示有记录证实的流转，箭头指向下一个节点。"}</span>
        </div>
        </details>
      </header>
      {!layout && canvasHasCrowding(nodes) && <p role="status" className="px-4 py-2 text-sm text-muted-foreground">原始布局重叠，请切换自动排布（不修改快照）。</p>}
      {graph.warning && (
        <p
          role="status"
          className="mx-4 mb-3 rounded bg-muted p-3 aiflow-type-body"
        >
          {graph.warning}
        </p>
      )}
      {initialFocus.warning && !selected && !occurrence && (
        <p
          role="status"
          className="mx-4 mb-3 rounded bg-aiflow-warning-surface p-3 aiflow-type-body"
        >
          {initialFocus.warning}
        </p>
      )}
      <div data-run-canvas-body="" style={workspace ? undefined : {height: expanded ? "min(78vh,900px)" : "clamp(360px,58vh,640px)"}}>
        <div
          ref={viewport}
          role="region"
          aria-label="实例只读流程画布"
        >
          {nodes.length ? (
            <ReactFlow<ViewerNode, Edge>
              key={run.id}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onMove={(_event, value) => viewport.current?.style.setProperty("--canvas-zoom", String(value.zoom))}
              onInit={instance => {
                api.current = instance;
                setReady(true);
              }}
              onNodeClick={(_e, n) => choose(n.id)}
              onNodesChange={changes => {
                if (!changes.some(change => change.type === "dimensions" && change.dimensions)) return;
                setSizes(previous => {
                  const next = new Map(previous);
                  for (const change of changes)
                    if (change.type === "dimensions" && change.dimensions) next.set(change.id, change.dimensions);
                  return next;
                });
              }}
              fitView
              fitViewOptions={initialFit}
              minZoom={0.01}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              elementsSelectable
              panOnDrag
              zoomOnScroll={false}
              onlyRenderVisibleElements={measured}
              ariaLabelConfig={{
                "controls.zoomIn.ariaLabel": "放大画布",
                "controls.zoomOut.ariaLabel": "缩小画布",
                "controls.fitView.ariaLabel": "显示全图",
                "minimap.ariaLabel": "实例流程缩略图",
              }}
              proOptions={{ hideAttribution: true }}
            >
              <ViewportMeasurement onReady={setMeasured} />
              <Background color="var(--aiflow-canvas-dot)" gap={24} size={1} />
              <Controls showInteractive={false} fitViewOptions={overviewFit} onFitView={() => showRunView(false)} />
              <MiniMap
                style={{ width: 160, height: 80 }}
                className="hidden lg:block"
                pannable
                zoomable
                nodeColor={node =>
                  node.data.item &&
                  (node.data.item as RunRecord).status === "success"
                    ? "#22c55e"
                    : "#94a3b8"
                }
              />
            </ReactFlow>
          ) : (
            <p className="p-6 aiflow-type-body text-muted-foreground">
              尚无可展示的节点。
            </p>
          )}
        </div>

        <aside
          className="nokey min-w-0 overflow-y-auto"
          style={workspace ? undefined : { maxHeight: expanded ? "min(78vh,900px)" : "640px" }}
          data-run-node-details
          role="region"
          aria-label={workspace ? "节点执行记录" : "节点执行详情"}
          tabIndex={workspace ? undefined : 0}
        >
          {workspace ? (
            <>
              <header data-run-records-header="">
                <h2 className="aiflow-type-section-title font-semibold">节点执行记录</h2>
                <span className="aiflow-type-meta text-muted-foreground">{executionEntries.length} 条</span>
              </header>
              <div ref={recordsScroll} data-run-records-scroll="" tabIndex={0}>
                {run.childLinks?.length > 0 && (
                  <details className="run-record-disclosure">
                    <summary className="aiflow-type-control cursor-pointer font-medium">父子运行</summary>
                    <DurableRunLinks links={run.childLinks} runId={String(run.id)} />
                  </details>
                )}
                {run.errorJson && (
                  <details className="run-record-disclosure">
                    <summary className="aiflow-type-control cursor-pointer font-medium text-aiflow-danger">查看实例错误</summary>
                    <RunPayloadDetails title="实例错误" value={run.errorJson} kind="error" />
                  </details>
                )}
                {selected && !activeRecordId && activeDetails}
                {executionEntries.length ? (
                  <ol data-run-records-list="">
                    {executionEntries.map(({ node, statusLabel, orderLabel, occurrence, totalOccurrences }) => {
                      const isActive = activeRecordId === node.id;
                      return (
                        <li key={node.id} data-run-execution-record="">
                          <button
                            type="button"
                            ref={isActive ? activeRecordButton : undefined}
                            data-run-record-id={node.id}
                            data-node-id={node.nodeId}
                            aria-current={isActive ? "true" : undefined}
                            onClick={() => choose(node.nodeId, node.id)}
                          >
                            <span className="aiflow-type-control break-words font-medium">{node.nodeName || graphNodesById.get(node.nodeId)?.name || node.nodeId}</span>
                            <span className={`run-record-status aiflow-type-meta rounded border px-1.5 ${colors[node.status] ?? inactiveColor}`}>{statusLabel}</span>
                            <span className="aiflow-type-meta break-words text-muted-foreground">
                              {orderLabel}{totalOccurrences > 1 ? ` · 第 ${occurrence} 次` : ""}
                            </span>
                            <span className="aiflow-type-meta text-right text-muted-foreground">{formatRunDuration(node.durationMs)}</span>
                            <span className="aiflow-type-meta col-span-2 break-all text-muted-foreground">
                              {workflowNodeTypeLabel(node.nodeType ?? graphNodesById.get(node.nodeId)?.type)} · {node.nodeId}
                            </span>
                          </button>
                          {isActive && <div data-run-record-body="">{activeDetails}</div>}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className={surfaceClass1}>暂无节点执行记录。</p>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="grid gap-1 aiflow-type-body">
                查看节点
                <select
                  aria-label="查看实例节点"
                  className={selectClass}
                  value={active?.id ?? ""}
                  onChange={e => {
                    choose(e.target.value);
                  }}
                >
                  {!active && <option value="" disabled>请选择节点</option>}
                  {graph.nodes.map(n => (
                    <option key={n.id} value={n.id}>
                      {n.name} · {runNodeLabels[n.status]}
                    </option>
                  ))}
                </select>
              </label>
              {activeDetails}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
