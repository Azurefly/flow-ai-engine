import { useMemo, useState, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
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
import { RunApprovalProgress } from "./RunApprovalProgress";
import { approvalGroupsForRecord } from "@shared/run-approval-progress";
import { runGraphFitOptions } from "@shared/run-graph-viewport";
import { workflowNodeTypeLabel } from "@shared/workflow-node-label";
import { Button } from "./ui/button";
type ViewerNode = Node<
  { item: RunGraphNode; choose: (id: string) => void; selected: boolean },
  "runNode"
>;
const inactiveColor = "border-border bg-muted text-muted-foreground";
const selectClass = "h-11 min-w-0 rounded border border-border bg-card px-2";
const colors: Record<string, string> = {
  idle: "border-border bg-card text-muted-foreground",
  success:
    "border-aiflow-success-border bg-aiflow-success-surface text-aiflow-success",
  failed:
    "border-aiflow-danger-border bg-aiflow-danger-surface text-aiflow-danger",
  running: "border-aiflow-info-border bg-aiflow-info-surface text-aiflow-info",
  waiting:
    "border-aiflow-warning-border bg-aiflow-warning-surface text-aiflow-warning",
  skipped: inactiveColor,
  stopped: inactiveColor,
};
function RunNode({ data }: NodeProps<ViewerNode>) {
  const item = data.item as RunRecord;
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ opacity: 0 }}
      />
      <button
        type="button"
        onClick={() => (data.choose as (id: string) => void)(item.id)}
        aria-label={`${item.name}，${item.status === "waiting" && item.type === "operate" ? "待办理" : runNodeLabels[item.status]}，${item.records.length}次执行`}
        className={`w-56 rounded-lg border-2 p-3 text-left shadow-sm ${colors[item.status]} ${data.selected ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
      >
        <span className="block break-words aiflow-type-body font-semibold">
          {item.name}
        </span>
        <span className="mt-2 block aiflow-type-body">
          {runNodeLabels[item.status]}
        </span>
        <span className="mt-1 block aiflow-type-meta">
          {item.records.length
            ? `${item.records.length} 次执行${item.activeCount ? ` · ${item.activeCount} 处等待` : ""}`
            : "尚未到达"}
        </span>
      </button>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ opacity: 0 }}
      />
    </>
  );
}
const nodeTypes = { runNode: RunNode };
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
}: {
  run: RunRecord;
  focusRequest?: { nodeId: string; recordId: string; version: number };
  entryTaskId?: string;
  renderDataOutput?: (record: RunRecord) => React.ReactNode;
}) {
  const graph = useMemo(() => projectRunGraph(run), [run]);
  const initialFocus = useMemo(
    () => resolveRunGraphFocus(run, graph.nodes, entryTaskId),
    [run, graph, entryTaskId]
  );
  const [selected, setSelected] = useState("");
  const [occurrence, setOccurrence] = useState("");
  const chosenRecords = useRef(new Map<string, string>());
  const [layout, setLayout] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const api = useRef<ReactFlowInstance<ViewerNode, Edge> | null>(null);
  const [ready, setReady] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [sizes, setSizes] = useState(new Map<string, { width: number; height: number }>());
  const [initialFit] = useState(() => runGraphFitOptions(initialFocus.nodeId));
  const overview = useRef(false);
  const fit = (nodeId?: string) => {
    overview.current = !nodeId;
    void api.current?.fitView(runGraphFitOptions(nodeId));
  };
  const current = graph.nodes.filter(n =>
    ["running", "waiting", "failed"].includes(n.status)
  );
  const active =
    graph.nodes.find(n => n.id === selected) ??
    graph.nodes.find(n => n.id === initialFocus.nodeId);
  const record = resolveRunGraphRecord(active, initialFocus, occurrence);
  const pending =
    record && ["waiting", "running", "pending"].includes(record.status);
  const choose = (id: string) => {
    fit(id);
    if (id === active?.id) return;
    if (active && record) chosenRecords.current.set(active.id, record.id);
    setSelected(id);
    setOccurrence(chosenRecords.current.get(id) ?? "");
  };
  const nodes: ViewerNode[] = graph.nodes.map(n => ({
    id: n.id,
    type: "runNode",
    position: layout ? n.layout : n.position,
    data: { item: n, choose, selected: active?.id === n.id },
    draggable: false,
    connectable: false,
    measured: sizes.get(n.id),
  }));
  const edges: Edge[] = graph.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    label: e.label
      ? `${e.returning ? "返回 · " : ""}${e.label}${e.confirmed ? ` · 已确认${e.confirmed}次` : ""}`
      : undefined,
    style: {
      stroke: e.confirmed ? "#2563eb" : "#94a3b8",
      strokeWidth: e.confirmed ? 3 : 1.5,
      strokeDasharray: e.returning ? "6 4" : undefined,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: e.confirmed ? "#2563eb" : "#94a3b8",
    },
    labelStyle: { fontSize: 12 },
    interactionWidth: 14,
  }));
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
  useEffect(() => {
    if (!ready || !measured) return;
    void api.current?.fitView(runGraphFitOptions(overview.current ? undefined : focusId.current));
  }, [layout, ready, measured, expanded]);
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
  return (
    <section
      ref={root}
      data-run-execution-graph
      className="min-w-0 scroll-mt-20 rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h3 className="aiflow-type-section-title font-semibold text-foreground">
            实例流程图
          </h3>
          <p className="aiflow-type-body mt-1 text-muted-foreground">
            {graph.hasSnapshot ? "基于本次运行快照" : "仅有节点执行记录"} · {graph.nodes.length} 个节点 ·{" "}
            {current.filter(n => n.activeCount).length} 处进行中
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || !measured}
            onClick={() => fit()}
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
            onClick={() => setLayout(x => !x)}
          >
            {layout ? "原始布局" : "自动排布"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={expanded}
            onClick={() => setExpanded(x => !x)}
          >
            {expanded ? "收起画布" : "展开画布"}
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 aiflow-type-meta text-muted-foreground">
        {Object.entries(runNodeLabels).map(([key, label]) => (
          <span key={key} className="inline-flex items-center gap-1">
            <i className={`h-3 w-3 rounded border ${colors[key]}`} />
            {label}
          </span>
        ))}
        <span>{run.flowType === "data" ? "灰线：快照依赖；节点颜色：执行状态。" : "灰线：定义；蓝线：已确认。"}</span>
        <span>点击节点放大阅读，查看全图浏览整体关系。</span>
      </div>
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
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          style={{
            height: expanded ? "min(78vh,900px)" : "clamp(360px,58vh,640px)",
          }}
          className="min-w-0 border-y border-border bg-muted/30 lg:border-r"
          role="region"
          aria-label="实例只读流程画布"
        >
          {nodes.length ? (
            <ReactFlow<ViewerNode, Edge>
              key={run.id}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
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
              <Background gap={22} />
              <Controls showInteractive={false} fitViewOptions={overviewFit} onFitView={() => { overview.current = true; }} />
              <MiniMap
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
          className="min-w-0 overflow-y-auto p-4"
          style={{ maxHeight: expanded ? "min(78vh,900px)" : "640px" }}
          data-run-node-details
          role="region"
          aria-label="节点执行详情"
          tabIndex={0}
        >
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
          {active && (
            <div className="mt-4 space-y-4">
              <p className="break-words aiflow-type-section-title font-semibold text-foreground">
                {active.name}
              </p>
              {active.records.length > 1 && (
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
                <p className="aiflow-type-body text-muted-foreground">
                  {active.records.length
                    ? "请选择执行批次后查看本次办理。"
                    : "此节点尚未执行。"}
                </p>
              ) : (
                <>
                  <p className="aiflow-type-body text-muted-foreground">
                    本次：{runNodeLabels[record.status] ?? record.status} · 耗时{" "}
                    {record.durationMs ?? "—"} ms
                  </p>
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
          )}
        </aside>
      </div>
    </section>
  );
}
