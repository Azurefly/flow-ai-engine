import { useMemo, useState, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  projectRunGraph,
  parseRunValue,
  runNodeLabels,
  type RunRecord,
  type RunGraphNode,
} from "@shared/run-execution-graph";
import { RunPayloadDetails } from "./RunPayloadDetails";
import { Button } from "./ui/button";
type ViewerNode = Node<
  { item: RunGraphNode; choose: (id: string) => void; selected: boolean },
  "runNode"
>;
const colors: Record<string, string> = {
  idle: "border-border bg-card text-muted-foreground",
  success:
    "border-aiflow-success-border bg-aiflow-success-surface text-aiflow-success",
  failed:
    "border-aiflow-danger-border bg-aiflow-danger-surface text-aiflow-danger",
  running: "border-aiflow-info-border bg-aiflow-info-surface text-aiflow-info",
  waiting:
    "border-aiflow-warning-border bg-aiflow-warning-surface text-aiflow-warning",
  skipped: "border-border bg-muted text-muted-foreground",
  stopped: "border-border bg-muted text-muted-foreground",
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
export default function RunExecutionCanvas({
  run,
  focusRequest,
}: {
  run: RunRecord;
  focusRequest?: { nodeId: string; recordId: string; version: number };
}) {
  const graph = useMemo(() => projectRunGraph(run), [run]);
  const [selected, setSelected] = useState("");
  const [occurrence, setOccurrence] = useState("");
  const [layout, setLayout] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const api = useRef<ReactFlowInstance<ViewerNode, Edge> | null>(null);
  const [ready, setReady] = useState(false);
  const current = graph.nodes.filter(n =>
    ["running", "waiting", "failed"].includes(n.status)
  );
  const active =
    graph.nodes.find(n => n.id === selected) ??
    current[0] ??
    graph.nodes.at(-1);
  const record =
    active?.records.find((r: RunRecord) => r.id === occurrence) ??
    (active?.activeCount
      ? active.records
          .filter((r: RunRecord) =>
            ["running", "waiting", "pending"].includes(r.status)
          )
          .at(-1)
      : active?.records.at(-1));
  const choose = (id: string) => {
    setSelected(id);
    setOccurrence("");
  };
  const nodes: ViewerNode[] = graph.nodes.map(n => ({
    id: n.id,
    type: "runNode",
    position: layout ? n.layout : n.position,
    data: { item: n, choose, selected: active?.id === n.id },
    draggable: false,
    connectable: false,
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
  const focusId = useRef(active?.id);
  focusId.current = active?.id;
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () =>
        void api.current?.fitView({
          ...(focusId.current ? { nodes: [{ id: focusId.current }] } : {}),
          padding: 0.25,
          minZoom: 0.65,
          maxZoom: 1,
          duration: 0,
        }),
      50
    );
    return () => clearTimeout(timer);
  }, [layout, ready]);
  const root = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusRequest) {
      setSelected(focusRequest.nodeId);
      setOccurrence(focusRequest.recordId);
      if (ready) {
        void api.current?.fitView({
          nodes: [{ id: focusRequest.nodeId }],
          padding: 0.25,
          minZoom: 0.65,
          maxZoom: 1,
          duration: 0,
        });
        root.current?.scrollIntoView({ block: "start", behavior: "auto" });
      }
    }
  }, [focusRequest, ready]);
  const focus = () => {
    if (active && api.current)
      void api.current.fitView({
        nodes: [{ id: active.id }],
        padding: 0.25,
        maxZoom: 1,
        minZoom: 0.3,
        duration: 0,
      });
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
            基于本次运行快照 · {graph.nodes.length} 个节点 ·{" "}
            {current.filter(n => n.activeCount).length} 处进行中
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!ready}
            onClick={() =>
              void api.current?.fitView({
                padding: 0.18,
                minZoom: 0.01,
                maxZoom: 1,
                duration: 0,
              })
            }
          >
            查看全图
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || !active}
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
        <span>灰线为定义关系；蓝线为有明确执行结果的分支。</span>
      </div>
      {graph.warning && (
        <p
          role="status"
          className="mx-4 mb-3 rounded bg-muted p-3 aiflow-type-body"
        >
          {graph.warning}
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
              fitView
              fitViewOptions={{ padding: 0.18, minZoom: 0.01, maxZoom: 1 }}
              minZoom={0.01}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              elementsSelectable
              panOnDrag
              zoomOnScroll={false}
              onlyRenderVisibleElements
              ariaLabelConfig={{
                "controls.zoomIn.ariaLabel": "放大画布",
                "controls.zoomOut.ariaLabel": "缩小画布",
                "controls.fitView.ariaLabel": "显示全图",
                "minimap.ariaLabel": "实例流程缩略图",
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={22} />
              <Controls showInteractive={false} />
              <MiniMap
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
              className="h-11 min-w-0 rounded border border-border bg-card px-2"
              value={active?.id ?? ""}
              onChange={e => {
                choose(e.target.value);
                void api.current?.fitView({
                  nodes: [{ id: e.target.value }],
                  padding: 0.25,
                  minZoom: 0.3,
                  maxZoom: 1,
                  duration: 0,
                });
              }}
            >
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
                    className="h-11 min-w-0 rounded border border-border bg-card px-2"
                    value={record?.id ?? ""}
                    onChange={e => setOccurrence(e.target.value)}
                  >
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
                  此节点尚未执行。
                </p>
              ) : (
                <>
                  <p className="aiflow-type-body text-muted-foreground">
                    本次：{runNodeLabels[record.status] ?? record.status} · 耗时{" "}
                    {record.durationMs ?? "—"} ms
                  </p>
                  {legacyAmbiguous && (
                    <p
                      role="status"
                      className="rounded bg-muted p-2 aiflow-type-body"
                    >
                      部分旧任务缺少批次标识，请结合下方操作记录核对办理人。
                    </p>
                  )}
                  {activities.map((t: RunRecord) => (
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
                  <RunPayloadDetails
                    title="本次办理结果"
                    value={parseRunValue(record.outputJson)}
                    kind="output"
                    nodeType={active.type}
                  />
                  <RunPayloadDetails
                    title="错误原因"
                    value={parseRunValue(record.errorJson)}
                    kind="error"
                  />
                  <details>
                    <summary className="cursor-pointer aiflow-type-body text-muted-foreground">
                      查看输入及记录信息
                    </summary>
                    <div className="mt-3">
                      <RunPayloadDetails
                        title="本次输入"
                        value={record.inputJson}
                        kind="input"
                      />
                      <div className="mt-2 break-all aiflow-type-meta text-muted-foreground">
                        <RunPayloadDetails
                          title="记录信息"
                          value={{
                            id: record.id,
                            runId: run.id,
                            nodeId: record.nodeId,
                            nodeType: record.nodeType,
                            status: record.status,
                            startedAt: record.startedAt,
                            finishedAt: record.finishedAt,
                            createdAt: record.createdAt,
                            sequenceNo: record.sequenceNo,
                            durationMs: record.durationMs,
                          }}
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
