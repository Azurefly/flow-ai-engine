import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  ControlButton,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ChevronDown,
  CircleCheck,
  CirclePlay,
  CircleStop,
  GitBranch,
  LocateFixed,
  Maximize,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import { workflowNodeTypeLabel } from "../../shared/workflow-node-label";
import { canvasNodeRects } from "../../shared/workflow-canvas-geometry";
import { workflowEdgeCaption } from "../../shared/workflow-edge-caption";
import { CanvasConnectionEdge } from "../src/components/CanvasConnectionEdge";
import {
  definition,
  nodesById,
  participantStatus,
  phases,
  type LeaveNode,
} from "./leave-demo";

type NodeStatus = "idle" | "reached" | "current";
type CanvasNode = Node<
  {
    definition: LeaveNode;
    status: NodeStatus;
    selected: boolean;
  },
  "approval"
>;

const labels: Record<NodeStatus, string> = {
  idle: "尚未到达",
  reached: "已到达",
  current: "当前节点",
};
const nodeIcons: Record<string, LucideIcon> = {
  start: CirclePlay,
  state: CircleCheck,
  operate: SquarePen,
  router: GitBranch,
  end: CircleStop,
};
const nodeSize = { width: 158, height: 74 };
const nodeLayout = definition.nodes.map(node => ({
  id: node.id,
  position: node.position,
  data: { definition: node },
  ...nodeSize,
}));
const overviewBounds = getNodesBounds(nodeLayout);
const rects = canvasNodeRects(nodeLayout.map(node => ({ ...node, measured: nodeSize })));

function ApprovalNode({ data }: NodeProps<CanvasNode>) {
  const node = data.definition;
  const Icon = nodeIcons[node.type];
  const typeLabel = workflowNodeTypeLabel(node.type);
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <button
        type="button"
        className="graph-node"
        data-status={data.status}
        aria-pressed={data.selected}
        aria-label={node.name + "，" + labels[data.status]}
        tabIndex={-1}
      >
        <span className="graph-node-icon">
          <Icon size={18} aria-hidden="true" />
        </span>
        <span className="graph-node-copy">
          {typeLabel !== node.name && (
            <span className="graph-node-type">{typeLabel}</span>
          )}
          <strong>{node.name}</strong>
        </span>
      </button>
      <Handle type="source" position={Position.Right} />
    </>
  );
}

const nodeTypes = { approval: ApprovalNode };
const edgeTypes = { approval: CanvasConnectionEdge };

function CanvasControls({ phaseIndex }: { phaseIndex: number }) {
  const { setViewport, viewportInitialized } = useReactFlow<CanvasNode, Edge>();
  const width = useStore(store => store.width);
  const height = useStore(store => store.height);
  const phase = phases[phaseIndex];

  const showBounds = useCallback(
    (bounds: typeof overviewBounds) => {
      if (!viewportInitialized || !width || !height) return;
      void setViewport(
        getViewportForBounds(bounds, width, height, 0.08, 1, 0.13)
      );
    },
    [height, setViewport, viewportInitialized, width]
  );

  const focusPhase = useCallback(() => {
    const ids = width < 560 ? [phase.currentNode] : phase.focusNodes;
    showBounds(
      getNodesBounds(nodeLayout.filter(node => ids.includes(node.id)))
    );
  }, [phase, showBounds, width]);

  useEffect(focusPhase, [focusPhase]);

  return (
    <Controls
      position="bottom-left"
      showInteractive={false}
      showFitView={false}
    >
      <ControlButton
        onClick={() => showBounds(overviewBounds)}
        title="显示全图"
        aria-label="显示全图"
      >
        <Maximize aria-hidden="true" />
      </ControlButton>
      <ControlButton
        onClick={focusPhase}
        title="定位当前阶段"
        aria-label="定位当前阶段"
      >
        <LocateFixed aria-hidden="true" />
      </ControlButton>
    </Controls>
  );
}

function nodeDescription(node: LeaveNode): string {
  if (node.type === "start") return "读取请假原因，初始化流程实例。";
  if (node.type === "end") return "汇总申请状态和请假原因。";
  const config = node.config;
  if ("instruction" in config && config.instruction) return config.instruction;
  if ("routes" in config && config.routes?.length) {
    return config.routes.map(route => route.label).join(" · ");
  }
  return participantStatus(node) ?? "进入下一项自动操作。";
}

export default function ApprovalCanvas({ phaseIndex }: { phaseIndex: number }) {
  const phase = phases[phaseIndex];
  const [selection, setSelection] = useState<{ phase: number; id: string }>();
  const selectedId =
    selection?.phase === phaseIndex ? selection.id : phase.currentNode;
  const selectedNode = nodesById.get(selectedId);
  const selectedType = workflowNodeTypeLabel(selectedNode?.type);
  const reached = useMemo(
    () =>
      new Set(
        phases.slice(0, phaseIndex + 1).flatMap(item => item.completedNodes)
      ),
    [phaseIndex]
  );
  const nodes: CanvasNode[] = nodeLayout.map(node => ({
    ...node,
    type: "approval",
    data: {
      ...node.data,
      status: reached.has(node.id)
        ? "reached"
        : node.id === phase.currentNode
          ? "current"
          : "idle",
      selected: node.id === selectedId,
    },
  }));
  const edges: Edge[] = definition.edges.map((edge, canvasLane) => {
    const visited =
      reached.has(edge.sourceNodeId) &&
      (reached.has(edge.targetNodeId) ||
        edge.targetNodeId === phase.currentNode);
    const source = nodesById.get(edge.sourceNodeId);
    const { label, tone } = workflowEdgeCaption(source?.type, source?.config, "sourceHandle" in edge ? edge.sourceHandle : undefined);
    return {
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      type: "approval",
      label,
      data: { canvasRects: rects, canvasLane, canvasTrace: visited, canvasTone: tone, quietLabels: true },
    };
  });

  return (
    <section className="panel canvas-panel" aria-labelledby="canvas-heading">
      <header className="panel-head">
        <h2 id="canvas-heading">流程画布</h2>
        <div className="legend" aria-label="画布图例">
          <span>
            <i className="current-dot" />
            当前节点
          </span>
          <span>
            <i className="reached-dot" />
            已到达
          </span>
        </div>
      </header>
      <div className="canvas-viewport" role="region" aria-label="请假流程画布">
        <ReactFlow<CanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          onNodeClick={(_event, node) =>
            setSelection({ id: node.id, phase: phaseIndex })
          }
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          minZoom={0.08}
          maxZoom={1.65}
          proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{
            "controls.zoomIn.ariaLabel": "放大画布",
            "controls.zoomOut.ariaLabel": "缩小画布",
            "minimap.ariaLabel": "流程缩略图",
          }}
        >
          <Background gap={20} size={1.15} color="#c8d2e4" />
          <CanvasControls phaseIndex={phaseIndex} />
          <MiniMap
            className="canvas-map"
            style={{ width: 144, height: 64 }}
            nodeColor={node =>
              node.data.status === "current"
                ? "#315df5"
                : node.data.status === "reached"
                  ? "#83c7b0"
                  : "#c5cfe0"
            }
            pannable
            zoomable
          />
        </ReactFlow>
      </div>
      {selectedNode && (
        <div className="canvas-details">
          <div className="canvas-detail-heading">
            <label className="node-picker">
              <select
                aria-label="查看节点"
                value={selectedId}
                onChange={event =>
                  setSelection({ id: event.target.value, phase: phaseIndex })
                }
              >
                {definition.nodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </label>
            {selectedType !== selectedNode.name && <span>{selectedType}</span>}
          </div>
          <p aria-live="polite">{nodeDescription(selectedNode)}</p>
        </div>
      )}
    </section>
  );
}
