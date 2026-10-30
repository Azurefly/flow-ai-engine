// Shared presentation strings keep equivalent controls consistent without changing handlers.
const surfaceClass1 = "aiflow-type-control h-11 min-h-11 min-w-0 rounded border border-border bg-card px-2 text-foreground outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-muted min-[1024px]:h-9 min-[1024px]:min-h-0";
import "./workflow-canvas-design.css";
import { CanvasConnectionEdge } from "./CanvasConnectionEdge";
import { canvasNodeRects, canvasHasCrowding, readableCanvasLayout, canvasContextIds, canvasConnectionPoints, canvasBounds, roundedCanvasPath } from "./workflow-canvas-geometry";
import { availableWorkflowReuseResources } from "@shared/workflow-reuse-resources";
import { readCanvasSourceHandles as sourceHandles } from "./workflow-canvas-handles";
import {
  isTemplateNodeType,
  type TemplateNodeType,
} from "@shared/workflow-template";
import { CanvasNameDialog } from "./CanvasNameDialog";
import { Input } from "./ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { useEditorViewport } from "@/hooks/useEditorViewport";
import { useInspectorGroupNavigation } from "@/hooks/useInspectorGroupNavigation";
import {
  dataflowInputFields,
  usesDataflowInputFieldSuggestions,
} from "../../../shared/dataflow-input-fields";
import { OperateApprovalEditor } from "./OperateApprovalEditor";
import { DataflowFieldListEditor } from "./DataflowFieldListEditor";
import { NodeNumberInput } from "./NodeNumberInput";
import { isDataflowFieldList } from "@shared/dataflow-field-list";
import { OPERATE_CONFIG_GROUPS } from "@shared/operate-config-groups";
import {
  bindParallelJoin,
  setRouterBroadcast,
} from "@shared/workflow-parallel-binding";
import {
  addEdge,
  getViewportForBounds,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useStore,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { normalizeReferenceRouterConfig } from "@shared/reference-router-config";
import { operateParticipantFields } from "@shared/operate-participant-fields";
import { WorkflowParticipantPicker } from "./WorkflowParticipantPicker";
import { hasCanvasInspectorSelection, readWorkflowLoopLimit } from "./workflow-canvas-viewport";
import { TaskFormSchemaEditor } from "./TaskFormSchemaEditor";
import { WorkflowOutcomeEditor } from "./WorkflowOutcomeEditor";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
} from "react";
import { toast } from "sonner";
import {
  Braces,
  CircleDot,
  Database,
  Download,
  FileText,
  Flag,
  Filter,
  FolderTree,
  GitBranch,
  Globe2,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MousePointer2,
  Move,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  ShieldCheck,
  Sigma,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMotionPreference } from "@/hooks/useMotionPreference";
import { useContextReveal } from "@/hooks/useContextReveal";
import { traceWorkflowNeighborhood } from "@shared/workflow-neighborhood";
import {
  syncRouterConfigTargets,
  updateLlmConnections,
  updateOperateConnections,
  updateRouterConnections,
} from "./workflow-canvas-routing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { selectWorkflowEndpoint } from "./workflow-endpoint-selection";
import { canConnectCanvasNodes } from "./workflow-canvas-connections";
import { AggregateMetricEditor } from "./aggregate-metric-editor";
import {
  DATA_FIELD_EDITOR_PROFILES,
  dataFieldEditorKey,
  newDataFieldItem,
  updateDataFieldItem,
} from "./workflow-data-field-editor";
import type { Definition } from "../../../server/workflow-service";
import {
  canConnectFlowNodeTypes,
  createDefaultNodeConfig,
  FLOW_NODE_ALLOWED_TARGETS,
  FLOW_NODE_DEFINITIONS,
  readConditionHandles,
  readOperateOutcomeMode,
  readOperateOutcomes,
  type FlowNodeDefinition,
  type FlowNodeType,
  type FlowType,
  type NodeConfig,
  validateNodeConfig,
} from "@shared/workflow-node-contract";
import { isFlowNodeAllowed } from "@shared/flow-profile-contract";
import { matchesWorkflowDefinitionSnapshot } from "@shared/workflow-publish";
import {
  hasStateInnateOperation,
  isConfigRecord,
  renameConfigProperty,
  showSigningPercent,
  STATE_INNATE_OPERATIONS,
  subflowSelectionConfig,
  toggleConfigSelection,
  toggleStateInnateOperation,
} from "./workflow-config-editor";

// UX 优化：共享相同样式字符串，保留配置控件及其事件。
const inspectorToolClass = "flex min-h-9 min-w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const canvasMenuItemClass = "block w-full px-3 py-2 text-left hover:bg-muted";
const canvasFieldLabelClass = "aiflow-type-control grid min-w-0 gap-1 text-muted-foreground";
const canvasSelectClass = "aiflow-type-control h-11 min-h-11 rounded-md border border-border bg-card px-3 font-normal text-foreground outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 min-[1024px]:h-9 min-[1024px]:min-h-0";
const canvasIconRowClass = "flex items-center gap-1";
const canvasDangerMenuItemClass = "block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50";
const canvasRemoveClass = "text-muted-foreground hover:text-red-600";
const canvasCompactControlClass = "aiflow-type-control h-7";
const canvasMutedTextClass = "text-muted-foreground";

const canvasHandleClass = "!h-2 !w-2 !border-2 shadow-none";
const canvasFieldGroupClass = "grid gap-1.5";
const canvasCompactLabelClass = "aiflow-type-control grid min-w-0 gap-1 font-medium text-muted-foreground";
const canvasStackedLabelClass = "aiflow-type-control grid gap-1.5 font-medium text-muted-foreground";
const canvasSectionTitleClass = "aiflow-type-section-title mb-2 font-semibold text-foreground";
const canvasNestedCardClass = "grid min-w-0 gap-2 rounded border border-border bg-card p-2";
const canvasRemoveFieldClass = "rounded px-1 text-muted-foreground hover:text-red-600";
const canvasMutedLabelClass = "aiflow-type-control font-medium text-muted-foreground";
const canvasConfigGridClass = "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3";
const canvasSectionHelpClass = "aiflow-type-body mt-2 text-muted-foreground";
const canvasBodyHelpClass = "aiflow-type-body text-muted-foreground";
const canvasResponsiveButtonClass = "min-h-11 text-sm min-[1024px]:min-h-9";
const canvasHelpLinkClass = "text-indigo-700 hover:underline";
const canvasFieldErrorClass = "aiflow-type-body text-red-600";

type NodeKind = FlowNodeType;
type FlowNodeData = { label: string; kind: NodeKind; config: NodeConfig };
type CanvasNode = Node<FlowNodeData, "workflowNode">;
type ReuseTemplate = {
  id: string;
  name: string;
  nodeType: TemplateNodeType;
  config: NodeConfig;
};
type ReuseSubflow = { id: string; name: string; isEnabled: boolean };
type InspectorMode = "normal" | "compact" | "maximized";
type ConfigState = "partial" | "editing" | "complete";
type CanvasContextMenu = {
  x: number;
  y: number;
  kind: "node" | "edge" | "pane" | "group";
  nodeId?: string;
  edgeId?: string;
} | null;
type CanvasPresentation = "auto" | "readable" | "original";
type HistorySnapshot = { nodes: CanvasNode[]; edges: Edge[]; presentation?: CanvasPresentation };

const nodeAppearance: Record<NodeKind, { icon: typeof Play; color: string }> = {
  start: { icon: Play, color: "#10b981" },
  end: { icon: Square, color: "#ef4444" },
  state: { icon: CircleDot, color: "#2563eb" },
  operate: { icon: Play, color: "#db2777" },
  router: { icon: Waypoints, color: "#7c3aed" },
  rest: { icon: Globe2, color: "#ea580c" },
  method: { icon: Globe2, color: "#c2410c" },
  form: { icon: FileText, color: "#0f766e" },
  wait: { icon: CircleDot, color: "#64748b" },
  message_catch: { icon: Waypoints, color: "#0369a1" },
  milestone: { icon: Flag, color: "#0d9488" },
  sql: { icon: Braces, color: "#475569" },
  transform: { icon: Braces, color: "#0891b2" },
  condition: { icon: GitBranch, color: "#8b5cf6" },
  llm: { icon: Sparkles, color: "#4f46e5" },
  subflow: { icon: FolderTree, color: "#7c3aed" },
  http: { icon: Globe2, color: "#d97706" },
  source: { icon: Database, color: "#0284c7" },
  table: { icon: Table2, color: "#0f766e" },
  filter: { icon: Filter, color: "#8b5cf6" },
  map: { icon: Braces, color: "#0891b2" },
  project: { icon: Table2, color: "#0e7490" },
  derive: { icon: Sigma, color: "#7c3aed" },
  join: { icon: GitBranch, color: "#0f766e" },
  union: { icon: Braces, color: "#0e7490" },
  aggregate: { icon: Sigma, color: "#b45309" },
  sort: { icon: Waypoints, color: "#475569" },
  deduplicate: { icon: Filter, color: "#be123c" },
  quality_gate: { icon: ShieldCheck, color: "#dc2626" },
  edit_sql: { icon: Braces, color: "#475569" },
  udf: { icon: Sigma, color: "#b45309" },
  sink: { icon: FileText, color: "#be123c" },
  output: { icon: FileText, color: "#be123c" },
};

const palette: Array<
  FlowNodeDefinition & { icon: typeof Play; color: string }
> = (Object.values(FLOW_NODE_DEFINITIONS) as FlowNodeDefinition[]).map(
  item => ({ ...item, ...nodeAppearance[item.type] })
);

function NodeTypeGlyph({
  icon: Icon,
  color,
  size = "card",
}: {
  icon: LucideIcon;
  color: string;
  size?: "card" | "palette";
}) {
  return (
    <span
      data-flow-node-glyph=""
      aria-hidden="true"
      className={
        size === "card"
          ? "grid h-9 w-9 shrink-0 place-items-center rounded-full border shadow-sm"
          : "grid h-7 w-7 shrink-0 place-items-center rounded-full border"
      }
      style={{
        color,
        borderColor: `${color}33`,
        backgroundColor: `${color}12`,
      }}
    >
      <Icon size={size === "card" ? 17 : 14} strokeWidth={2.2} />
    </span>
  );
}

function assessNodeConfig(
  kind: NodeKind,
  config: NodeConfig
): { state: ConfigState; error?: string } {
  try {
    validateNodeConfig(kind, config);
    const defaultConfig = createDefaultNodeConfig(kind);
    const changed = Object.keys(config).some(
      key => JSON.stringify(config[key]) !== JSON.stringify(defaultConfig[key])
    );
    return { state: changed ? "complete" : "editing" };
  } catch (error) {
    return {
      state: "partial",
      error:
        error instanceof Error
          ? error.message
          : "节点配置无效，请检查配置字段。",
    };
  }
}

function FlowNodeCard({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FlowNodeData;
  const canvasEdges = useStore(state =>
    nodeData.kind === "router" ? state.edges : null
  );
  const canvasNodes = useStore(state =>
    nodeData.kind === "router" ? state.nodes : null
  );
  const appearance = nodeAppearance[nodeData.kind];
  const configAssessment = assessNodeConfig(nodeData.kind, nodeData.config);
  const configState = configAssessment.state;
  const legacyHandles = useStore(state =>
    nodeData.kind === "operate" &&
    readOperateOutcomeMode(nodeData.config) === "legacy_cancel"
      ? JSON.stringify(
          state.edges
            .filter(edge => edge.source === id)
            .map(edge => edge.sourceHandle ?? "default")
            .sort()
        )
      : "[]"
  );
  const compact = useStore(state => state.transform[2] < 0.72);
  const handles = sourceHandles(
    nodeData.kind,
    nodeData.config,
    JSON.parse(legacyHandles)
  );
  const updateNodeInternals = useUpdateNodeInternals();
  const handleSignature = JSON.stringify(handles);
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleSignature, compact, updateNodeInternals]);
  const hasTarget = nodeData.kind !== "start";
  const routeItems: NodeConfig[] =
    nodeData.kind === "router"
      ? normalizeReferenceRouterConfig(nodeData.config).rules.map(rule => ({
          handle: rule.handle,
          label: rule.name,
          targetNodeId: rule.targetNodeId,
        }))
      : [];
  const llmGovernance =
    nodeData.kind === "llm" &&
    nodeData.config.governance &&
    typeof nodeData.config.governance === "object" &&
    !Array.isArray(nodeData.config.governance)
      ? (nodeData.config.governance as NodeConfig)
      : {};
  return (
    <div
      className={`flow-design-node ${selected ? "is-selected" : ""}`}
      title={nodeData.label}
      data-compact={compact ? "true" : undefined}
      data-node-kind={nodeData.kind}
      style={{ borderColor: selected ? "var(--aiflow-canvas-selected)" : "var(--border)" }}
    >
      <div
        data-canvas-node-accent="" className="absolute inset-x-0 top-0 h-1 rounded-t-2xl opacity-90"
        style={{ backgroundColor: appearance.color }}
      />
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Left}
          id="target"
          className={canvasHandleClass}
          style={{ backgroundColor: appearance.color }}
        />
      )}
      <div className="flow-design-node-row flex items-center gap-3">
        <NodeTypeGlyph icon={appearance.icon} color={appearance.color} />
        <div className="min-w-0 flex-1">
          <span className="flow-design-node-title block break-words text-sm font-semibold leading-5 text-foreground">
            {nodeData.label}
          </span>
          <span className="flow-design-node-type aiflow-type-meta mt-0.5 block break-words text-muted-foreground">
            {FLOW_NODE_DEFINITIONS[nodeData.kind].label}
          </span>
        </div>
        <span
          data-canvas-config-state={configState} className={`h-2 w-2 shrink-0 rounded-full ${configState === "partial" ? "bg-red-500" : configState === "editing" ? "bg-blue-500" : "bg-emerald-500"}`}
          title={
            configState === "partial"
              ? `未完全配置：${configAssessment.error}`
              : configState === "editing"
                ? "结构完整（默认），运行前仍需预检"
                : "结构完整，运行前仍需预检"
          }
        />
      </div>
      {nodeData.kind === "llm" && (
        <div className="flow-design-node-details aiflow-type-meta mt-3 flex flex-wrap gap-1.5 border-t border-border pt-2.5 font-semibold">
          <span className="rounded-md bg-indigo-50 px-1.5 py-1 text-indigo-700">
            {String(nodeData.config.model || "自动模型")}
          </span>
          <span className="rounded-md bg-muted px-1.5 py-1 text-muted-foreground">
            {String(llmGovernance.dataClassification || "internal")}
          </span>
          {nodeData.config.outputSchema ? (
            <span className="rounded-md bg-aiflow-success-surface px-1.5 py-1 text-aiflow-success">
              结构化输出
            </span>
          ) : null}
          {llmGovernance.humanReviewRequired === true ? (
            <span className="rounded-md bg-aiflow-warning-surface px-1.5 py-1 text-aiflow-warning">
              人工复核
            </span>
          ) : null}
          {Number(llmGovernance.maxCostMicros) > 0 ? (
            <span className="rounded-md bg-aiflow-danger-surface px-1.5 py-1 text-aiflow-danger">
              ≤ {Number(llmGovernance.maxCostMicros)} μ
            </span>
          ) : null}
        </div>
      )}
      {routeItems.length > 0 && (
        <div className="flow-design-node-details mt-3 grid gap-1.5 border-t border-border pt-2.5">
          {routeItems.map((route, index) => {
            const routeName = String(
              route.label ||
                route.routerRuleName ||
                route.handle ||
                `规则 ${index + 1}`
            );
            const routeHandle = String(route.handle ?? route.code ?? "default");
            const connectedTarget = canvasEdges?.find(
              edge =>
                edge.source === id &&
                (edge.sourceHandle || "default") === routeHandle
            )?.target;
            const routeTargetId = String(
              connectedTarget ||
                route.targetNodeId ||
                route.target ||
                route.routerTargetId ||
                ""
            );
            const targetNode = canvasNodes?.find(
              node => node.id === routeTargetId
            );
            const routeTarget = targetNode
              ? String(targetNode.data.label || routeTargetId)
              : routeTargetId || "待连线";
            return (
              <div
                key={String(route.handle || route.routerRuleId || index)}
                className="aiflow-type-control flex items-center justify-between gap-3"
              >
                <span
                  className="min-w-0 flex-1 truncate rounded-md bg-aiflow-special-surface px-1.5 py-1 font-semibold text-aiflow-special"
                  title={routeName}
                >
                  {routeName}
                </span>
                <span
                  className="max-w-24 truncate text-muted-foreground"
                  title={routeTarget}
                >
                  → {routeTarget}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {handles.map((id, index) => {
        const isApproved = id === "approved";
        const isRejected = id === "rejected";
        const isCompensation = id === "compensation";
        const handleColor = isApproved
          ? "#059669"
          : isRejected
            ? "#ef4444"
            : isCompensation
              ? "#f59e0b"
              : appearance.color;
        return (
          <Handle
            key={id}
            type="source"
            position={Position.Right}
            id={id}
            className={canvasHandleClass}
            style={{
              top: `${((index + 1) / (handles.length + 1)) * 100}%`,
              backgroundColor: handleColor,
            }}
            title={
              nodeData.kind === "operate" &&
              readOperateOutcomeMode(nodeData.config) === "legacy_cancel" &&
              id !== "default"
                ? `继续执行（历史出口：${id}）`
                : ((nodeData.kind === "operate"
                    ? readOperateOutcomes(nodeData.config).find(
                        outcome => outcome.sourceHandle === id
                      )?.label
                    : routeItems.find(route => route.handle === id)
                        ?.label) as string) ||
                  (
                    {
                      default: "默认出口",
                      compensation: "补偿出口",
                    } as Record<string, string>
                  )[id] ||
                  id
            }
          />
        );
      })}
    </div>
  );
}

const nodeTypes = { workflowNode: FlowNodeCard };
const canvasEdgeTypes = { workspace: CanvasConnectionEdge };

function defaultDefinition(): Definition {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      {
        id: "start",
        type: "start",
        name: "开始",
        position: { x: 90, y: 200 },
        config: createDefaultNodeConfig("start"),
      },
      {
        id: "end",
        type: "end",
        name: "结束",
        position: { x: 510, y: 200 },
        config: createDefaultNodeConfig("end"),
      },
    ],
    edges: [
      {
        id: "start-end",
        sourceNodeId: "start",
        sourceHandle: "default",
        targetNodeId: "end",
      },
    ],
  };
}

function colorFor(kind: NodeKind) {
  return nodeAppearance[kind]?.color ?? "#64748b";
}

function toFlowNodes(definition: Definition): CanvasNode[] {
  return definition.nodes.map(node => ({
    id: node.id,
    type: "workflowNode",
    position: node.position,
    data: { label: node.name, kind: node.type, config: node.config },
  }));
}

function toFlowEdges(definition: Definition): Edge[] {
  return definition.edges.map(edge => ({
    id: edge.id,
    source: edge.sourceNodeId,
    sourceHandle: edge.sourceHandle,
    target: edge.targetNodeId,
    targetHandle: "target",
    data: { loop: edge.loop ?? null },
    animated: false,
    interactionWidth: 24,
    style: { stroke: "#64748b", strokeWidth: 2 },
  }));
}

function toDefinition(
  nodes: Node[],
  edges: Edge[],
  base: Definition
): Definition {
  const baseNodes = new Map(base.nodes.map(node => [node.id, node]));
  const baseEdges = new Map(base.edges.map(edge => [edge.id, edge]));
  return {
    ...base,
    nodes: nodes.map(node => ({
      ...baseNodes.get(node.id),
      id: node.id,
      type: (node.data as FlowNodeData).kind,
      name: String((node.data as FlowNodeData).label ?? "未命名节点"),
      position: node.position,
      config: (node.data as FlowNodeData).config ?? {},
    })),
    edges: edges.map(edge => ({
      ...baseEdges.get(edge.id),
      id: edge.id,
      sourceNodeId: edge.source,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetNodeId: edge.target,
      ...(edge.data && Object.hasOwn(edge.data, "loop") ? { loop: (edge.data.loop ?? undefined) as Definition["edges"][number]["loop"] } : {}),
    })),
  };
}

/**
 * Automatically calculates a clean, non-overlapping hierarchical layout for canvas nodes.
 * Guarantees zero overlapping cards and clear horizontal and vertical spacing.
 */
export function autoLayoutNodes<T extends { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; data?: { kind?: string; label?: string } }>(nodes: T[], edges: Edge[]): T[] {
  return readableCanvasLayout(nodes, edges);
}

function syncRouterRouteTargets(
  nodes: CanvasNode[],
  edges: Edge[],
  changedRouterId?: string
): CanvasNode[] {
  return nodes.map(node => {
    if (
      node.data.kind !== "router" ||
      (changedRouterId && node.id !== changedRouterId)
    )
      return node;
    const outgoing = edges.filter(edge => edge.source === node.id);
    return {
      ...node,
      data: {
        ...node.data,
        config: syncRouterConfigTargets(node.data.config, outgoing),
      },
    };
  });
}
function escapeXml(value: string) {
  return value.replace(
    /[<>&"']/g,
    character =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character
  );
}

function ConfigFieldEditor({
  field,
  value,
  fallback,
  disabled,
  runtimeOptions,
  fieldSuggestions,
  runtimePlaceholder = "请选择已启用的私有子流程",
  runtimeError,
  onRetryOptions,
  aggregateMetrics = false,
  nodeKind,
  routeTargetLabels,
  outcomeMode,
  operateConfig,
  onChange,
}: {
  field: FlowNodeDefinition["fields"][number];
  value: unknown;
  fallback: unknown;
  disabled: boolean;
  runtimeOptions?: Array<{ value: string; label: string; disabled?: boolean; reason?: string }>;
  fieldSuggestions?: string[];
  runtimePlaceholder?: string;
  runtimeError?: string;
  onRetryOptions?: () => void;
  aggregateMetrics?: boolean;
  nodeKind?: NodeKind;
  routeTargetLabels?: Record<string, string>;
  outcomeMode?: string;
  operateConfig?: NodeConfig;
  onChange: (value: unknown) => void;
}) {
  const effectiveValue = value ?? fallback;
  // Keep a local editing draft while committing accepted text on every input.
  // The parent key still resets drafts when switching nodes or fields.
  const scalarValue =
    effectiveValue != null && typeof effectiveValue !== "object"
      ? String(effectiveValue)
      : "";
  const suggestionId = useId();
  const [draft, setDraft] = useState(scalarValue);
  useEffect(() => setDraft(scalarValue), [scalarValue]);
  const label = (
    <span className="aiflow-type-control flex items-center gap-1 font-semibold text-foreground">
      {field.required && <i className="not-italic text-red-500">*</i>}
      {field.label}
    </span>
  );
  const inputClass =
    "aiflow-type-control h-11 min-h-11 w-full rounded-md border border-border bg-card px-2.5 text-foreground outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-muted disabled:text-muted-foreground min-[1024px]:h-9 min-[1024px]:min-h-0";
  if (nodeKind === "operate" && field.key === "outcomes")
    return (
      <WorkflowOutcomeEditor
        value={effectiveValue}
        mode={outcomeMode ?? "legacy_cancel"}
        config={operateConfig}
        idPrefix={suggestionId}
        disabled={disabled}
        targets={routeTargetLabels}
        onChange={onChange}
        advanced={
          <NestedStructuredValueEditor
            value={effectiveValue}
            disabled={disabled}
            onChange={onChange}
          />
        }
      />
    );
  if (nodeKind === "operate" && field.key === "formSchema")
    return (
      <TaskFormSchemaEditor
        value={effectiveValue}
        disabled={disabled}
        onChange={onChange}
        advanced={
          <NestedStructuredValueEditor
            value={effectiveValue}
            disabled={disabled}
            onChange={onChange}
          />
        }
      />
    );
  if (
    aggregateMetrics &&
    Array.isArray(effectiveValue) &&
    effectiveValue.every(isConfigRecord)
  )
    return (
      <AggregateMetricEditor
        value={effectiveValue}
        disabled={disabled}
        onChange={onChange}
      />
    );
  if (runtimeOptions) {
    const current = String(effectiveValue ?? "");
    const selectedOption=runtimeOptions.find(option=>option.value===current);
    const availabilityError=runtimeError || (selectedOption?.disabled ? selectedOption.reason || "当前选择尚不可执行，请选择可用资源。" : undefined);
    const currentAvailable = runtimeOptions.some(
      option => option.value === current
    );
    return (
      <div className={canvasFieldGroupClass}>
        <label className={canvasFieldGroupClass}>
          {label}
          <select
            className={inputClass}
            aria-invalid={Boolean(availabilityError) || undefined}
            aria-describedby={availabilityError ? `${suggestionId}-availability` : undefined}
            disabled={disabled}
            value={current}
            onChange={event => onChange(event.target.value)}
          >
            <option value="">{runtimePlaceholder}</option>
            {current && !currentAvailable && (
              <option value={current}>当前选择不可用 · {current}</option>
            )}
            {runtimeOptions.map(option => (
              <option
                key={option.value}
                value={option.value}
                disabled={"disabled" in option && Boolean(option.disabled)}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <FieldHelp help={field.help} />
        {availabilityError && (
          <p id={`${suggestionId}-availability`} role="alert" className={canvasFieldErrorClass}>
            {availabilityError}
          </p>
        )}
        {availabilityError && onRetryOptions && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetryOptions}
          >
            重新加载选项
          </Button>
        )}
      </div>
    );
  }
  if (field.kind === "boolean")
    return (
      <label className={canvasFieldGroupClass}>
        {label}
        <span className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={Boolean(effectiveValue)}
            disabled={disabled}
            onChange={event => onChange(event.target.checked)}
          />
          {effectiveValue ? "是" : "否"}
        </span>
        <FieldHelp help={field.help} />
      </label>
    );
  if (field.kind === "select")
    return (
      <label className={canvasFieldGroupClass}>
        {label}
        <select
          className={inputClass}
          disabled={disabled}
          value={String(effectiveValue ?? "")}
          onChange={event => onChange(event.target.value)}
        >
          {field.options?.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldHelp help={field.help} />
      </label>
    );
  if (field.kind === "textarea")
    return (
      <label className={canvasFieldGroupClass}>
        {label}
        <textarea
          className="min-h-20 w-full rounded-md border border-border bg-card p-2.5 text-sm text-foreground outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-muted disabled:text-muted-foreground"
          value={draft}
          onChange={event => {
            setDraft(event.target.value);
            onChange(event.target.value);
          }}
          disabled={disabled}
        />
        <FieldHelp help={field.help} />
      </label>
    );
  if (field.kind === "json")
    return (
      <StructuredValueEditor
        field={field}
        nodeKind={nodeKind}
        value={effectiveValue}
        disabled={disabled}
        routeTargetLabels={routeTargetLabels}
        onChange={onChange}
      />
    );
  if (
    field.kind === "template" &&
    effectiveValue &&
    typeof effectiveValue === "object"
  )
    return (
      <StructuredValueEditor
        field={field}
        nodeKind={nodeKind}
        value={effectiveValue}
        disabled={disabled}
        onChange={onChange}
      />
    );
  if (field.kind === "number")
    return (
      <label className={canvasFieldGroupClass}>
        {label}
        <NodeNumberInput
          field={field}
          className={inputClass}
          value={value === null ? "" : effectiveValue}
          onChange={onChange}
          disabled={disabled}
        />
        <FieldHelp help={field.help} />
      </label>
    );
  return (
    <label className={canvasFieldGroupClass}>
      {label}
      <input
        placeholder={
          fieldSuggestions?.length ? "选择上游字段或手动填写" : undefined
        }
        list={fieldSuggestions?.length ? suggestionId : undefined}
        className={inputClass}
        value={draft}
        onChange={event => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        disabled={disabled}
      />
      {fieldSuggestions?.length ? (
        <datalist id={suggestionId}>
          {fieldSuggestions.map(name => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}
      {/* UX 优化：提示字段来源变化，保留手动填写与原校验、执行规则。 */}
      {fieldSuggestions?.length && draft.trim() && !fieldSuggestions.includes(draft.trim()) ? (
        <p role="status" className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          当前字段不在可确认的上游输出中，请核对读取字段、投影或聚合配置。仍可手动填写。
        </p>
      ) : null}
      <FieldHelp help={field.help} />
    </label>
  );
}

function configFieldValue(
  field: FlowNodeDefinition["fields"][number],
  config: NodeConfig
) {
  const direct = config[field.key];
  if (direct !== undefined && direct !== null && direct !== "") return direct;
  for (const alias of field.aliases ?? []) {
    const value = config[alias];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return direct;
}

function structuredValue(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function nextObjectKey(value: NodeConfig) {
  let index = 1;
  let key = "字段名";
  while (Object.prototype.hasOwnProperty.call(value, key)) {
    index += 1;
    key = "字段名" + index;
  }
  return key;
}

function StructuredPropertyNameInput({
  propertyKey,
  record,
  disabled,
  className,
  onChange,
}: {
  propertyKey: string;
  record: NodeConfig;
  disabled: boolean;
  className: string;
  onChange: (value: NodeConfig) => void;
}) {
  const [draft, setDraft] = useState(propertyKey);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(propertyKey);
    setError("");
  }, [propertyKey]);
  return (
    <span className="grid min-w-0 gap-1">
      <input
        className={className}
        value={draft}
        disabled={disabled}
        aria-label={"字段 " + propertyKey + " 名称"}
        aria-invalid={Boolean(error)}
        onChange={event => {
          setDraft(event.target.value);
          setError("");
        }}
        onBlur={() => {
          const next = renameConfigProperty(record, propertyKey, draft);
          if (next === record && draft !== propertyKey) {
            setError("字段名不能为空或重复，已保留原字段。");
            setDraft(propertyKey);
          } else if (next !== record) onChange(next);
        }}
      />
      {error && (
        <span role="alert" className={canvasFieldErrorClass}>
          {error}
        </span>
      )}
    </span>
  );
}

function NestedStructuredValueEditor({
  value,
  disabled,
  onChange,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const inputClass =
    surfaceClass1;
  if (Array.isArray(value)) {
    return (
      <div className={canvasNestedCardClass}>
        {value.map((item, index) => (
          <div
            key={index}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"
          >
            <NestedStructuredValueEditor
              value={item}
              disabled={disabled}
              onChange={next =>
                onChange(
                  value.map((current, itemIndex) =>
                    itemIndex === index ? next : current
                  )
                )
              }
            />
            <button
              type="button"
              className={canvasRemoveFieldClass}
              disabled={disabled}
              onClick={() =>
                onChange(value.filter((_, itemIndex) => itemIndex !== index))
              }
              aria-label={"删除第" + (index + 1) + "项"}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={canvasCompactControlClass}
            disabled={disabled}
            onClick={() => onChange([...value, ""])}
          >
            <Plus size={12} />
            添加值
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={canvasCompactControlClass}
            disabled={disabled}
            onClick={() => onChange([...value, {}])}
          >
            <Plus size={12} />
            添加对象
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={canvasCompactControlClass}
            disabled={disabled}
            onClick={() => onChange([...value, []])}
          >
            <Plus size={12} />
            添加数组
          </Button>
        </div>
      </div>
    );
  }
  if (value && typeof value === "object") {
    const record = value as NodeConfig;
    const entries = Object.entries(record);
    const updateEntries = (next: Array<[string, unknown]>) =>
      onChange(Object.fromEntries(next.filter(([key]) => key.trim())));
    return (
      <div className={canvasNestedCardClass}>
        {entries.map(([key, entryValue], index) => (
          <div
            key={key + "-" + index}
            className="grid min-w-0 grid-cols-[minmax(72px,.6fr)_minmax(0,1.4fr)_auto] gap-2"
          >
            <input
              className={inputClass}
              value={key}
              disabled={disabled}
              aria-label={"字段 " + key + " 名称"}
              onChange={event =>
                updateEntries(
                  entries.map(([currentKey, currentValue], itemIndex) =>
                    itemIndex === index
                      ? [event.target.value, currentValue]
                      : [currentKey, currentValue]
                  )
                )
              }
            />
            <NestedStructuredValueEditor
              value={entryValue}
              disabled={disabled}
              onChange={next =>
                updateEntries(
                  entries.map(([currentKey, currentValue], itemIndex) =>
                    itemIndex === index
                      ? [currentKey, next]
                      : [currentKey, currentValue]
                  )
                )
              }
            />
            <button
              type="button"
              className={canvasRemoveFieldClass}
              disabled={disabled}
              onClick={() =>
                updateEntries(
                  entries.filter((_, itemIndex) => itemIndex !== index)
                )
              }
              aria-label={"删除字段 " + key}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={canvasCompactControlClass}
            disabled={disabled}
            onClick={() => onChange({ ...record, [nextObjectKey(record)]: "" })}
          >
            <Plus size={12} />
            添加字段
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={canvasCompactControlClass}
            disabled={disabled}
            onClick={() => onChange({ ...record, [nextObjectKey(record)]: {} })}
          >
            <Plus size={12} />
            添加对象字段
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={canvasCompactControlClass}
            disabled={disabled}
            onClick={() => onChange({ ...record, [nextObjectKey(record)]: [] })}
          >
            <Plus size={12} />
            添加数组字段
          </Button>
        </div>
      </div>
    );
  }
  return (
    <input
      className={inputClass}
      value={String(value ?? "")}
      disabled={disabled}
      onChange={event => onChange(structuredValue(event.target.value))}
    />
  );
}

type OriginalFieldSpec = {
  key: string;
  label: string;
  help?: string;
  kind?:
    | "text"
    | "number"
    | "boolean"
    | "yes-no"
    | "structured"
    | "select"
    | "multi-select";
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
};

const ORIGINAL_OBJECT_FIELD_SPECS: Record<string, OriginalFieldSpec[]> = {
  zlcxz: [
    { key: "id", label: "流程 ID" },
    { key: "text", label: "流程名称" },
  ],
  bdcz: [
    { key: "bdcz", label: "绑定操作", kind: "structured" },
    {
      key: "bdczjs",
      label: "绑定操作角色",
      help: "发送方表示沿用上一步操作人，接收方表示沿用上一步接收人。",
      kind: "multi-select",
      options: [
        { value: "sender", label: "发送方" },
        { value: "acceptor", label: "接收方" },
      ],
    },
    {
      key: "hqhqsz",
      label: "签收方式",
      help: "或签任意一人通过；会签按比例；顺序会签按指定人员顺序逐一处理。",
      kind: "select",
      options: [
        { value: "", label: "普通单人/领取处理" },
        { value: "orSignFor", label: "或签" },
        { value: "andSignFor", label: "会签" },
        { value: "sequentialSignFor", label: "顺序会签" },
      ],
    },
    {
      key: "xzdfhq",
      label: "指定参与或签/会签的人员",
      help: "留空表示所有候选人；可填写内部用户 ID 列表或原版人员对象。",
      kind: "structured",
    },
    {
      key: "hqtgbfb",
      label: "会签通过百分比",
      help: "1 至 100；留空按 100% 全部通过。",
      kind: "number",
      min: 1,
      max: 100,
    },
  ],
  sxsz: [
    {
      key: "zdglxgfsz",
      label: "自动关联相关方",
      help: "部门、权限部门或直属上级会作为后续接收方补入流程。",
      kind: "multi-select",
      options: [
        { value: "unitWord", label: "相关方所属部门" },
        { value: "authUnitWord", label: "相关方权限部门" },
        { value: "upperAuthUnitWord", label: "相关方直属上级" },
      ],
    },
    { key: "yrdbmsfkcz", label: "引入部门可操作", kind: "yes-no" },
    { key: "xzdzlcjywc", label: "需完成的子流程", kind: "structured" },
  ],
  fsfsz: [
    { key: "fsfbm", label: "发送方编码" },
    {
      key: "fsflzsf",
      label: "发送方流转身份",
      help: "决定下一节点以本人、部门还是权限部门身份继续。",
      kind: "select",
      options: [
        { value: "以本人身份", label: "以本人身份" },
        { value: "以部门身份", label: "以部门身份" },
        { value: "以权限部门身份", label: "以权限部门身份" },
      ],
    },
    { key: "fsfgycz", label: "发送方固有操作" },
    { key: "lsjspz", label: "发送方临时角色", kind: "structured" },
  ],
  jsfsz: [
    { key: "jsfbm", label: "接收方编码" },
    { key: "jsfgycz", label: "接收方固有操作" },
    { key: "lsjspz", label: "接收方临时角色", kind: "structured" },
  ],
  zdzx: [
    { key: "sfzdzx", label: "是否自动执行", kind: "yes-no" },
    { key: "tjsz", label: "自动执行条件", kind: "structured" },
    { key: "code", label: "自动执行代码", kind: "structured" },
  ],
  jdgycz: [
    {
      key: "bj",
      label: "办结状态",
      kind: "yes-no",
      help: "当前状态是否作为办结状态。",
    },
    {
      key: "zdbj",
      label: "自动办结",
      kind: "yes-no",
      help: "进入该状态后是否自动办结。",
    },
    {
      key: "tsbjsyzlc",
      label: "同时办结所有子流程",
      kind: "yes-no",
      help: "办结时是否同步关闭所有子流程。",
    },
    {
      key: "cs",
      label: "抄送通知",
      kind: "yes-no",
      help: "流转至该状态时是否发送抄送通知。",
    },
  ],
};

const ORIGINAL_LIST_ITEM_SPECS: Record<string, OriginalFieldSpec[]> = {
  lysz: [
    { key: "routerRuleId", label: "路由 ID" },
    { key: "routerRuleName", label: "路由名称" },
    { key: "routerRulePriority", label: "优先权重", kind: "number" },
    { key: "mbjd", label: "目标节点" },
    { key: "tjsz", label: "条件设置", kind: "structured" },
    { key: "code", label: "路由代码", kind: "structured" },
  ],
  ywcz: [
    { key: "czid", label: "操作 ID", help: "业务操作唯一标识。" },
    {
      key: "czmc",
      label: "操作名称",
      help: "业务操作不触发流程流转，仅作为功能触发入口。",
    },
  ],
  qxkz: [
    { key: "qxid", label: "权限 ID" },
    { key: "qxmc", label: "权限名称" },
    { key: "qxzr", label: "权限载入", kind: "structured" },
    { key: "glljsz", label: "过滤拦截设置" },
    { key: "fsfsz", label: "发送方设置", kind: "structured" },
    { key: "jsfsz", label: "接收方设置", kind: "structured" },
    { key: "code", label: "权限代码", kind: "structured" },
  ],
  bddx: [
    { key: "bdid", label: "绑定 ID" },
    { key: "bdmc", label: "绑定名称" },
    { key: "bdzr", label: "绑定载入", kind: "structured" },
    {
      key: "hqfw",
      label: "获取范围",
      kind: "multi-select",
      options: [
        { value: "1", label: "人" },
        { value: "2", label: "部门" },
        { value: "3", label: "权限部门" },
      ],
    },
    { key: "fsfsz", label: "发送方设置", kind: "structured" },
    { key: "jsfsz", label: "接收方设置", kind: "structured" },
    { key: "code", label: "绑定代码", kind: "structured" },
  ],
  zlcck: [
    { key: "connect", label: "连接节点", kind: "structured" },
    { key: "end", label: "结束节点" },
  ],
};

function OriginalFieldControl({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: OriginalFieldSpec;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const inputClass =
    surfaceClass1;
  if (spec.kind === "structured")
    return (
      <NestedStructuredValueEditor
        value={value ?? []}
        disabled={disabled}
        onChange={onChange}
      />
    );
  if (spec.kind === "boolean")
    return (
      <label className="inline-flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
        启用
      </label>
    );
  if (spec.kind === "yes-no")
    return (
      <select
        className={inputClass}
        value={String(value ?? "否")}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      >
        <option value="否">否</option>
        <option value="是">是</option>
      </select>
    );
  if (spec.kind === "select")
    return (
      <select
        className={inputClass}
        value={String(value ?? "")}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      >
        {(spec.options ?? []).map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  if (spec.kind === "multi-select") {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    return (
      <div className="grid gap-1 rounded border border-border bg-card p-2">
        {(spec.options ?? []).map(option => (
          <label
            key={option.value}
            className="inline-flex items-center gap-2 text-xs font-normal text-foreground"
          >
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              disabled={disabled}
              onChange={event => {
                const next = new Set(selected);
                event.target.checked
                  ? next.add(option.value)
                  : next.delete(option.value);
                onChange(Array.from(next));
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }
  return (
    <input
      className={inputClass}
      type={spec.kind === "number" ? "number" : "text"}
      min={spec.min}
      max={spec.max}
      value={String(value ?? "")}
      disabled={disabled}
      onChange={event =>
        onChange(
          spec.kind === "number"
            ? structuredValue(event.target.value)
            : event.target.value
        )
      }
    />
  );
}

function OriginalObjectEditor({
  fieldKey,
  value,
  disabled,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const specs = ORIGINAL_OBJECT_FIELD_SPECS[fieldKey];
  const isArrayOfObjects = fieldKey === "jdgycz" && Array.isArray(value);
  const record = (() => {
    if (isArrayOfObjects) {
      const merged: NodeConfig = {};
      for (const item of value as any[])
        if (item && typeof item === "object") Object.assign(merged, item);
      return merged;
    }
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as NodeConfig)
      : {};
  })();
  const emitChange = (next: NodeConfig) => {
    if (isArrayOfObjects) {
      const entries = Object.entries(next).filter(
        ([, v]) => v !== undefined && v !== "" && v !== "否" && v !== false
      );
      onChange(entries.map(([k, v]) => ({ [k]: v })));
    } else {
      onChange(next);
    }
  };
  const knownKeys = new Set(specs.map(spec => spec.key));
  const extras = Object.fromEntries(
    Object.entries(record).filter(([key]) => !knownKeys.has(key))
  );
  const visibleSpecs = specs.filter(spec => {
    if (
      fieldKey === "bdcz" &&
      ["hqhqsz", "xzdfhq", "hqtgbfb"].includes(spec.key)
    )
      return false;
    if (spec.key === "hqtgbfb" && record["hqhqsz"] !== "andSignFor")
      return false;
    if (
      (spec.key === "zdbj" || spec.key === "tsbjsyzlc") &&
      record["bj"] !== "是" &&
      record["bj"] !== true
    )
      return false;
    return true;
  });
  return (
    <div className="grid gap-2">
      {visibleSpecs.map(spec => (
        <label
          key={spec.key}
          className={canvasCompactLabelClass}
        >
          <span>{spec.label}</span>
          <OriginalFieldControl
            spec={spec}
            value={record[spec.key]}
            disabled={disabled}
            onChange={next => emitChange({ ...record, [spec.key]: next })}
          />
          {spec.help && (
            <span className="aiflow-type-body font-normal text-muted-foreground">
              {spec.help}
            </span>
          )}
        </label>
      ))}
      {Object.keys(extras).length > 0 && (
        <div className="grid gap-1">
          <span className={canvasMutedLabelClass}>
            原版扩展字段
          </span>
          <NestedStructuredValueEditor
            value={extras}
            disabled={disabled}
            onChange={next => {
              const known = Object.fromEntries(
                specs
                  .filter(spec => record[spec.key] !== undefined)
                  .map(spec => [spec.key, record[spec.key]])
              );
              emitChange({
                ...known,
                ...(next && typeof next === "object" && !Array.isArray(next)
                  ? (next as NodeConfig)
                  : {}),
              });
            }}
          />
        </div>
      )}
    </div>
  );
}

function StructuredValueEditor({
  field,
  nodeKind,
  value,
  disabled,
  routeTargetLabels,
  onChange,
}: {
  field: FlowNodeDefinition["fields"][number];
  nodeKind?: NodeKind;
  value: unknown;
  disabled: boolean;
  routeTargetLabels?: Record<string, string>;
  onChange: (value: unknown) => void;
}) {
  const isList = Array.isArray(value);
  const list = isList ? value : [];
  const editorKey = dataFieldEditorKey(nodeKind, field.key);
  const isSpecializedList =
    isList &&
    (["routes", "fields", "restHeaderParam", "restGetBodyParam"].includes(
      field.key
    ) ||
      Boolean(
        ORIGINAL_LIST_ITEM_SPECS[editorKey] ||
          DATA_FIELD_EDITOR_PROFILES[editorKey]
      ));
  const updateList = (next: unknown[]) => onChange(next);
  const newListItem =
    newDataFieldItem(editorKey) ??
    (field.key === "routes"
      ? {
          handle: "route",
          label: "新分支",
          condition: { left: "{{input.value}}", operator: "equals", right: "" },
        }
      : field.key === "fields"
        ? { key: "field", label: "字段名称", type: "text", required: false }
        : ["restHeaderParam", "restGetBodyParam"].includes(field.key)
          ? { key: "", value: "" }
          : field.key === "lysz"
            ? {
                routerRuleId: "",
                routerRuleName: "",
                routerRulePriority: 1,
                mbjd: "",
                tjsz: [],
                code: [],
              }
            : field.key === "qxkz"
              ? {
                  qxid: "",
                  qxmc: "",
                  qxzr: [],
                  glljsz: "",
                  fsfsz: [],
                  jsfsz: [],
                  code: "",
                }
              : field.key === "bddx"
                ? {
                    bdid: "",
                    bdmc: "",
                    bdzr: [],
                    hqfw: [],
                    fsfsz: [],
                    jsfsz: [],
                    code: "",
                  }
                : field.key === "ywcz"
                  ? { czid: "", czmc: "" }
                  : field.key === "zlcck"
                    ? { connect: { id: "", text: "", yId: "" }, end: "" }
                    : "");
  const originalObject = ORIGINAL_OBJECT_FIELD_SPECS[field.key];
  return (
    <fieldset className="grid gap-2 rounded-md border border-border bg-muted p-2.5">
      <legend className="px-1 text-xs font-semibold text-foreground">
        {field.required && <i className="mr-1 not-italic text-red-500">*</i>}
        {field.label}
      </legend>
      {isDataflowFieldList(nodeKind, field.key) ? (
        <DataflowFieldListEditor
          value={value}
          disabled={disabled}
          label={field.label}
          onChange={onChange}
        />
      ) : isSpecializedList ? (
        <div className="grid gap-2">
          {list.map((item, index) => (
            <StructuredListRow
              key={field.key + "-" + index}
              fieldKey={editorKey}
              item={item}
              disabled={disabled}
              routeTargetLabels={routeTargetLabels}
              onChange={next =>
                updateList(
                  list.map((current, itemIndex) =>
                    itemIndex === index ? next : current
                  )
                )
              }
              onRemove={() =>
                updateList(list.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit text-xs"
            disabled={disabled}
            onClick={() => updateList([...list, newListItem])}
          >
            <Plus size={13} />
            添加一项
          </Button>
        </div>
      ) : originalObject ? (
        <OriginalObjectEditor
          fieldKey={field.key}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      ) : (
        <NestedStructuredValueEditor
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      <FieldHelp
        help={field.help.replace(/JSON (对象|数组|标量)/g, "结构化字段")}
      />
    </fieldset>
  );
}

function StructuredListRow({
  fieldKey,
  item,
  disabled,
  routeTargetLabels,
  onChange,
  onRemove,
}: {
  fieldKey: string;
  item: unknown;
  disabled: boolean;
  routeTargetLabels?: Record<string, string>;
  onChange: (value: unknown) => void;
  onRemove: () => void;
}) {
  const inputClass =
    surfaceClass1;
  const originalSpecs =
    DATA_FIELD_EDITOR_PROFILES[fieldKey]?.fields ??
    ORIGINAL_LIST_ITEM_SPECS[fieldKey];
  if (originalSpecs) {
    const record =
      fieldKey === "data_sort" && typeof item === "string"
        ? { field: item, direction: "asc" }
        : item && typeof item === "object" && !Array.isArray(item)
          ? (item as NodeConfig)
          : {};
    const knownKeys = new Set(originalSpecs.map(spec => spec.key));
    const extras = Object.fromEntries(
      Object.entries(record).filter(([key]) => !knownKeys.has(key))
    );
    return (
      <div className="grid gap-2 rounded border border-border bg-card p-2">
        <div className="flex items-center justify-between">
          <span className="aiflow-type-control font-semibold text-muted-foreground">
            {!DATA_FIELD_EDITOR_PROFILES[fieldKey] && "原版"}
            {DATA_FIELD_EDITOR_PROFILES[fieldKey]?.label ??
              (fieldKey === "lysz"
                ? "路由"
                : fieldKey === "qxkz"
                  ? "权限"
                  : fieldKey === "bddx"
                    ? "绑定对象"
                    : fieldKey === "ywcz"
                      ? "业务操作"
                      : "子流程出口")}
            配置
          </span>
          <button
            type="button"
            className={canvasRemoveClass}
            disabled={disabled}
            onClick={onRemove}
            aria-label={
              DATA_FIELD_EDITOR_PROFILES[fieldKey]
                ? "删除数据字段"
                : "删除原版配置项"
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
        {originalSpecs.map(spec => (
          <label
            key={spec.key}
            className={canvasCompactLabelClass}
          >
            <span>{spec.label}</span>
            <OriginalFieldControl
              spec={spec}
              value={
                fieldKey === "data_sort" && spec.key === "direction"
                  ? String(record[spec.key] ?? record.order ?? "asc").toLowerCase()
                  : record[spec.key]
              }
              disabled={disabled}
              onChange={next => onChange(updateDataFieldItem(fieldKey, record, spec.key, next))}
            />
          </label>
        ))}
        {Object.keys(extras).length > 0 && (
          <div className="grid gap-1">
            <span className={canvasMutedLabelClass}>
              原版扩展字段
            </span>
            <NestedStructuredValueEditor
              value={extras}
              disabled={disabled}
              onChange={next => {
                const known = Object.fromEntries(
                  originalSpecs
                    .filter(spec => record[spec.key] !== undefined)
                    .map(spec => [spec.key, record[spec.key]])
                );
                onChange({
                  ...known,
                  ...(next && typeof next === "object" && !Array.isArray(next)
                    ? (next as NodeConfig)
                    : {}),
                });
              }}
            />
          </div>
        )}
      </div>
    );
  }
  if (fieldKey === "routes") {
    const route = item && typeof item === "object" ? (item as NodeConfig) : {};
    const targetLabel =
      routeTargetLabels?.[String(route.handle ?? route.code ?? "default")] ??
      route.targetNodeId ??
      route.target;
    const condition =
      route.condition && typeof route.condition === "object"
        ? (route.condition as NodeConfig)
        : {};
    const roleKeys = Array.isArray(route.roleKeys)
      ? route.roleKeys.map(String)
      : [];
    return (
      <div className="grid min-w-0 gap-3 rounded-lg border border-aiflow-special-border bg-card p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-aiflow-special">
            {String(route.label ?? "新路径")}
          </span>
          <button
            type="button"
            className="grid min-h-11 min-w-11 place-items-center text-muted-foreground hover:text-red-600"
            disabled={disabled}
            onClick={onRemove}
            aria-label="删除路由规则"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <label className={canvasFieldLabelClass}>
            路径句柄
            <input
              className={inputClass}
              placeholder="例如 employee"
              value={String(route.handle ?? "")}
              disabled={disabled}
              onChange={event =>
                onChange({ ...route, handle: event.target.value })
              }
            />
          </label>
          <label className={canvasFieldLabelClass}>
            路径名称
            <input
              className={inputClass}
              placeholder="例如 员工路径"
              value={String(route.label ?? "")}
              disabled={disabled}
              onChange={event =>
                onChange({ ...route, label: event.target.value })
              }
            />
          </label>
        </div>
        <label className={canvasFieldLabelClass}>
          优先级（-1 为默认规则）
          <input
            type="number"
            step="any"
            className={inputClass}
            value={String(route.routerRulePriority ?? route.priority ?? 0)}
            disabled={disabled}
            onChange={event => {
              const priority =
                event.target.value === "" ? "" : Number(event.target.value);
              onChange({
                ...route,
                priority,
                routerRulePriority: priority,
                isDefault: priority === -1,
              });
            }}
          />
          <span className="aiflow-type-meta">
            值越大越先匹配；同值按创建顺序。留空按 0 处理。
          </span>
        </label>
        <label className={canvasFieldLabelClass}>
          目标节点
          <span className="aiflow-type-control flex min-h-11 items-center rounded border border-border bg-muted px-2 text-foreground">
            {String(targetLabel ?? "请从此路径句柄连线到目标状态节点")}
          </span>
        </label>
        <label className={canvasFieldLabelClass}>
          流程身份（逗号分隔）
          <input
            className={inputClass}
            placeholder="leave_employee, initiator"
            value={roleKeys.join(", ")}
            disabled={disabled}
            onChange={event =>
              onChange({
                ...route,
                roleKeys: event.target.value
                  .split(",")
                  .map(value => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <details className="rounded border border-border bg-muted">
          <summary className="aiflow-type-control cursor-pointer px-2 py-3 font-medium text-muted-foreground">
            附加数据条件
          </summary>
          <div className="grid min-w-0 gap-2 border-t border-border p-2 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)]">
            <input
              className={inputClass}
              placeholder="左值"
              value={String(condition.left ?? "")}
              disabled={disabled}
              onChange={event =>
                onChange({
                  ...route,
                  condition: { ...condition, left: event.target.value },
                })
              }
            />
            <select
              className={inputClass}
              value={String(condition.operator ?? "equals")}
              disabled={disabled}
              onChange={event =>
                onChange({
                  ...route,
                  condition: { ...condition, operator: event.target.value },
                })
              }
            >
              <option value="equals">等于</option>
              <option value="notEquals">不等于</option>
              <option value="contains">包含</option>
              <option value="exists">存在</option>
              <option value="greaterThan">大于</option>
              <option value="lessThan">小于</option>
            </select>
            <input
              className={inputClass}
              placeholder="右值"
              value={String(condition.right ?? "")}
              disabled={disabled}
              onChange={event =>
                onChange({
                  ...route,
                  condition: {
                    ...condition,
                    right: structuredValue(event.target.value),
                  },
                })
              }
            />
          </div>
        </details>
      </div>
    );
  }
  if (fieldKey === "fields") {
    const itemField =
      item && typeof item === "object" ? (item as NodeConfig) : {};
    return (
      <div className="grid grid-cols-[1fr_1fr_100px_auto_auto] items-center gap-2 rounded border border-border bg-card p-2">
        <input
          className={inputClass}
          placeholder="字段标识"
          value={String(itemField.key ?? "")}
          disabled={disabled}
          onChange={event =>
            onChange({ ...itemField, key: event.target.value })
          }
        />
        <input
          className={inputClass}
          placeholder="显示名称"
          value={String(itemField.label ?? "")}
          disabled={disabled}
          onChange={event =>
            onChange({ ...itemField, label: event.target.value })
          }
        />
        <select
          className={inputClass}
          value={String(itemField.type ?? "text")}
          disabled={disabled}
          onChange={event =>
            onChange({ ...itemField, type: event.target.value })
          }
        >
          <option value="text">文本</option>
          <option value="number">数字</option>
          <option value="date">日期</option>
          <option value="select">选项</option>
        </select>
        <label className="aiflow-type-control flex items-center gap-1 text-muted-foreground">
          <input
            type="checkbox"
            checked={Boolean(itemField.required)}
            disabled={disabled}
            onChange={event =>
              onChange({ ...itemField, required: event.target.checked })
            }
          />
          必填
        </label>
        <button
          type="button"
          className={canvasRemoveClass}
          disabled={disabled}
          onClick={onRemove}
          aria-label="删除表单字段"
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  }
  if (["restHeaderParam", "restGetBodyParam"].includes(fieldKey)) {
    const pair = item && typeof item === "object" ? (item as NodeConfig) : {};
    const label = fieldKey === "restHeaderParam" ? "请求头" : "GET 参数";
    return (
      <div className="grid grid-cols-[minmax(88px,.8fr)_minmax(0,1.2fr)_auto] gap-2">
        <input
          className={inputClass}
          placeholder={`${label}名称`}
          value={String(pair.key ?? "")}
          disabled={disabled}
          aria-label={`${label}名称`}
          onChange={event => onChange({ ...pair, key: event.target.value })}
        />
        <input
          className={inputClass}
          placeholder={`${label}值`}
          value={String(pair.value ?? "")}
          disabled={disabled}
          aria-label={`${label}值`}
          onChange={event =>
            onChange({ ...pair, value: structuredValue(event.target.value) })
          }
        />
        <button
          type="button"
          className={canvasRemoveClass}
          disabled={disabled}
          onClick={onRemove}
          aria-label={`删除${label}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <input
        className={inputClass}
        value={String(item ?? "")}
        disabled={disabled}
        onChange={event => onChange(structuredValue(event.target.value))}
      />
      <button
        type="button"
        className={canvasRemoveClass}
        disabled={disabled}
        onClick={onRemove}
        aria-label="删除列表项"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function FieldHelp({ help }: { help: string }) {
  return <p className={canvasBodyHelpClass}>{help}</p>;
}

type ConfigField = FlowNodeDefinition["fields"][number];
type ConfigGroup = { label: string; keys: string[] };

const CONFIG_GROUPS: Partial<Record<NodeKind, ConfigGroup[]>> = {
  join: [
    {
      label: "输入数据",
      keys: ["leftInputNodeId", "rightInputNodeId"],
    },
    {
      label: "关联条件",
      keys: ["kind", "leftKeys", "rightKeys"],
    },
  ],
  http: [
    {
      label: "请求配置",
      keys: ["endpointRef", "secretRef", "url", "method", "headers", "body"],
    },
    {
      label: "超时与重试",
      keys: ["timeout", "retryMaxAttempts", "retryBaseDelayMs"],
    },
    {
      label: "写入与流量控制",
      keys: [
        "writeSafety",
        "compensationNodeId",
        "circuitFailureThreshold",
        "circuitResetMs",
        "concurrencyKey",
        "concurrencyLimit",
      ],
    },
  ],
  llm: [
    {
      label: "模型与提示词",
      keys: ["model", "systemPrompt", "prompt"],
    },
    {
      label: "输出与失败处理",
      keys: ["maxTokens", "outputSchema", "timeoutMs", "failureHandle"],
    },
    {
      label: "数据与成本控制",
      keys: ["governance"],
    },
  ],
  state: [
    {
      label: "基础状态",
      keys: ["nodeDh", "jdmc", "stateType", "stateColor"],
    },
    {
      label: "人员与操作",
      keys: ["bdjs", "jdgycz", "ywcz"],
    },
    {
      label: "流程参与方显示",
      keys: ["flowStatus", "bdym"],
    },
  ],
  operate: OPERATE_CONFIG_GROUPS,
  router: [
    {
      label: "分支规则",
      keys: ["routes", "defaultRoute"],
    },
    {
      label: "基础信息",
      keys: ["nodeDh", "lymc", "gbms", "parallelJoinNodeId"],
    },
    {
      label: "兼容规则",
      keys: ["lysz"],
    },
  ],
  subflow: [
    {
      label: "调用配置",
      keys: ["subflowId", "input", "executionMode"],
    },
    {
      label: "迁移兼容",
      keys: ["zlcxz", "nodeDh", "sfgqzlc", "zlcfqf", "gdtj", "zlcrk", "zlcck"],
    },
  ],
};

function configFieldGroups(
  kind: NodeKind,
  fields: ConfigField[],
  config: NodeConfig
) {
  if (kind === "operate") fields = operateParticipantFields(fields, config);
  if (
    kind === "router" &&
    !normalizeReferenceRouterConfig(config).broadcast &&
    !config.parallelJoinNodeId
  )
    fields = fields.filter(field => field.key !== "parallelJoinNodeId");
  const definitions = CONFIG_GROUPS[kind];
  if (!definitions)
    return [
      {
        label: "节点配置",
        fields,
      },
    ];
  const byKey = new Map(fields.map(field => [field.key, field]));
  const groups = definitions.map(group => ({
    ...group,
    fields: group.keys
      .map(key => byKey.get(key))
      .filter((field): field is ConfigField => Boolean(field)),
  }));
  const groupedKeys = new Set(definitions.flatMap(group => group.keys));
  const remaining = fields.filter(field => !groupedKeys.has(field.key));
  return remaining.length
    ? [
        ...groups,
        {
          label: "其他兼容配置",
          keys: [],
          fields: remaining,
        },
      ]
    : groups;
}

export default function WorkflowCanvas({
  workflowId,
  projectId,
  flowType = "state",
  definition,
  readOnly = false,
  compactReadOnlyPreview = false,
  viewportFit = false,
  onDefinitionChange,
  templates = [],
  subflows = [],
  onSaveTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onToggleSubflow,
  onDeleteSubflow,
  showCanvasActions = true,
}: {
  workflowId?: string;
  projectId?: string;
  flowType?: FlowType;
  definition?: Definition | null;
  readOnly?: boolean;
  compactReadOnlyPreview?: boolean;
  viewportFit?: boolean;
  onDefinitionChange?: (definition: Definition) => void;
  templates?: ReuseTemplate[];
  subflows?: ReuseSubflow[];
  onSaveTemplate?: (
    template: Omit<ReuseTemplate, "id">
  ) => void | Promise<unknown>;
  onUpdateTemplate?: (
    template: ReuseTemplate,
    updates: { name?: string; config?: NodeConfig }
  ) => void | Promise<unknown>;
  onDeleteTemplate?: (id: string) => void;
  onToggleSubflow?: (subflow: ReuseSubflow, isEnabled: boolean) => void;
  onDeleteSubflow?: (id: string) => void;
  showCanvasActions?: boolean;
}) {
  const [nameDialog, setNameDialog] = useState<{
    title: string;
    initialName: string;
    onSave: (name: string) => void | Promise<unknown>;
  } | null>(null);
  useEffect(() => setNameDialog(null), [workflowId, readOnly]);
  const initial = definition ?? defaultDefinition();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(
    toFlowNodes(initial)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groupNavigation = useInspectorGroupNavigation(selectedId);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [deletedEdge, setDeletedEdge] = useState<Edge | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu>(null);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("normal");
  const previousInspectorExpandedRef = useRef(false);
  const [inspectorLocked, setInspectorLocked] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("");
  const inspectorTabId = useId();
  const loopLimitErrorId = useId();
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance<
    CanvasNode,
    Edge
  > | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [nodePaletteSearch, setNodePaletteSearch] = useState("");
  const [reuseSearch, setReuseSearch] = useState("");
  const lastInitialFitKeyRef = useRef<string | null>(null);
  const participantPreview = trpc.workflow.previewParticipants.useMutation();
  const editorRegionRef = useRef<HTMLDivElement>(null);
  const editorViewportStyle = useEditorViewport(
    editorRegionRef,
    viewportFit && !compactReadOnlyPreview && !fullscreen
  );
  const [paletteOpen, setPaletteOpen] = useState<"nodes" | "reuse" | null>(null);
  const paletteOpenRef = useRef<"nodes" | "reuse" | null>(null);
  const paletteNodeCount = useRef(nodes.length);
  const suppressPaletteFocus = useRef(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayLocationFocus = useRef(false);
  const changePalette = (kind: "nodes" | "reuse", open: boolean) => {
    if (open) {
      paletteNodeCount.current = nodes.length;
      paletteOpenRef.current = kind;
      setPaletteOpen(kind);
    } else if (paletteOpenRef.current === kind) {
      paletteOpenRef.current = null;
      setPaletteOpen(null);
    }
  };
  const closePaletteFocus = (event: Event) => {
    if (suppressPaletteFocus.current || paletteOpenRef.current)
      event.preventDefault();
    suppressPaletteFocus.current = false;
  };
  useEffect(() => {
    if (paletteOpen && nodes.length > paletteNodeCount.current) {
      suppressPaletteFocus.current = true;
      paletteOpenRef.current = null;
      setPaletteOpen(null);
      inspectorHeadingRef.current?.focus({ preventScroll: true });
      revealInspector();
    }
  }, [nodes.length, paletteOpen]);
  useEffect(() => {
    paletteOpenRef.current = null;
    setPaletteOpen(null);
    setDisplayOpen(false);
  }, [workflowId, readOnly]);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const inspectorHeadingRef = useRef<HTMLHeadingElement>(null);
  const inspectorRevealFrameRef = useRef<number | null>(null);
  const flowViewportRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<Definition>(initial);
  const appliedDefinitionRef = useRef("");
  const emittedDefinitionRef = useRef("");
  const appliedWorkflowRef = useRef<string | undefined>(undefined);
  const latestNodesRef = useRef(nodes);
  latestNodesRef.current = nodes;
  const latestEdgesRef = useRef(edges);
  latestEdgesRef.current = edges;
  const { prefersReducedMotion } = useMotionPreference();
  // UX: display projection never enters toDefinition; explicit layout edits retain history.
  const [canvasPresentation, setCanvasPresentation] = useState<CanvasPresentation>("auto");
  const presentationRef = useRef(canvasPresentation); presentationRef.current = canvasPresentation;
  const readingDragRef = useRef<HistorySnapshot | null>(null);
  const readingActive = canvasPresentation === "readable" || (canvasPresentation === "auto" && canvasHasCrowding(nodes));
  const readingNodes = useMemo(() => readingActive ? readableCanvasLayout(nodes, edges) : nodes, [nodes, edges, readingActive]);
  const displayedNodesRef = useRef(readingNodes); displayedNodesRef.current = readingNodes;
  const readingActiveRef = useRef(readingActive); readingActiveRef.current = readingActive;
  const fitCanvas = useCallback((nodeId?: string | null, edgeId?: string | null, duration = 180) => {
    if (!reactFlow || !flowViewportRef.current) return Promise.resolve(false);
    const allRects = canvasNodeRects(displayedNodesRef.current), currentEdges = latestEdgesRef.current;
    const ids = edgeId ? new Set(currentEdges.filter(e => e.id === edgeId).flatMap(e => [e.source, e.target])) : canvasContextIds(allRects, currentEdges, nodeId);
    const rects = allRects.filter(n => ids.has(n.id));
    const points = currentEdges.flatMap((edge, lane) => {
      if (!ids.has(edge.source) || !ids.has(edge.target)) return [];
      const a = allRects.find(n => n.id === edge.source), b = allRects.find(n => n.id === edge.target);
      return a && b ? canvasConnectionPoints({ x: a.x + a.width + 4, y: a.y + a.height / 2 }, { x: b.x - 4, y: b.y + b.height / 2 }, allRects, edge.source, edge.target, lane) : [];
    });
    const viewport = flowViewportRef.current;
    return reactFlow.setViewport(getViewportForBounds(canvasBounds(rects, points), viewport.clientWidth, viewport.clientHeight, 0.1, 1, 0.12), { duration: prefersReducedMotion ? 0 : duration });
  }, [reactFlow, prefersReducedMotion]);

  const definitionSignature = useMemo(
    () => JSON.stringify(definition ?? defaultDefinition()),
    [definition]
  );

  const revealInspector = useCallback(() => {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    if (inspectorRevealFrameRef.current !== null) window.cancelAnimationFrame(inspectorRevealFrameRef.current);
    inspectorRevealFrameRef.current = window.requestAnimationFrame(() => {
      inspectorRevealFrameRef.current = null;
      inspectorHeadingRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
      inspectorHeadingRef.current?.focus({ preventScroll: true });
    });
  }, [prefersReducedMotion]);
  const inspectCanvasNode = useCallback((nodeId: string) => {
    const node = latestNodesRef.current.find(item => item.id === nodeId);
    if (!node) return;
    setSelectedId(node.id);
    setSelectedEdgeId(null);
    setContextMenu(null);
    setInspectorMode("normal");
    setNodes(current => current.map(item => ({ ...item, selected: item.id === node.id })));
    void fitCanvas(node.id);
    revealInspector();
  }, [fitCanvas, revealInspector, setNodes]);
  const inspectCanvasEdge = useCallback((edgeId: string) => {
    const edge = latestEdgesRef.current.find(item => item.id === edgeId);
    if (!edge) return;
    setSelectedId(null);
    setSelectedEdgeId(edge.id);
    setContextMenu(null);
    setInspectorMode("normal");
    setNodes(current => current.map(node => ({ ...node, selected: false })));
    void fitCanvas(null, edge.id);
    revealInspector();
  }, [fitCanvas, revealInspector, setNodes]);
  useEffect(() => () => {
    if (inspectorRevealFrameRef.current !== null) window.cancelAnimationFrame(inspectorRevealFrameRef.current);
  }, []);
  const isLayoutAnimatingRef = useRef(false);
  const layoutRafRef = useRef<number | null>(null);

  const pastRef = useRef<HistorySnapshot[]>([]);
  const futureRef = useRef<HistorySnapshot[]>([]);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const dragStartSnapshotRef = useRef<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const pushHistory = useCallback(
    (currentNodes?: CanvasNode[], currentEdges?: Edge[], presentation = presentationRef.current) => {
      if (readOnly) return;
      const n = currentNodes ?? latestNodesRef.current;
      const e = currentEdges ?? latestEdgesRef.current;
      const snapshot: HistorySnapshot = {
        nodes: structuredClone(n),
        edges: structuredClone(e),
        presentation,
      };
      pastRef.current = [...pastRef.current.slice(-29), snapshot];
      futureRef.current = [];
      setHistoryState({ canUndo: true, canRedo: false });
    },
    [readOnly]
  );

  const undo = useCallback(() => {
    if (readOnly || !pastRef.current.length) return;
    const previous = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    const currentSnapshot: HistorySnapshot = {
      nodes: structuredClone(latestNodesRef.current),
      edges: structuredClone(latestEdgesRef.current),
      presentation: presentationRef.current,
    };
    futureRef.current = [currentSnapshot, ...futureRef.current.slice(0, 29)];
    setCanvasPresentation(previous.presentation ?? "auto");
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setSelectedId(current =>
      previous.nodes.some(node => node.id === current) ? current : null
    );
    setSelectedEdgeId(current =>
      previous.edges.some(edge => edge.id === current) ? current : null
    );
    setHistoryState({
      canUndo: pastRef.current.length > 0,
      canRedo: true,
    });
    toast.info("已撤销上一步操作");
  }, [readOnly, setEdges, setNodes]);

  const redo = useCallback(() => {
    if (readOnly || !futureRef.current.length) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    const currentSnapshot: HistorySnapshot = {
      nodes: structuredClone(latestNodesRef.current),
      edges: structuredClone(latestEdgesRef.current),
      presentation: presentationRef.current,
    };
    pastRef.current = [...pastRef.current.slice(-29), currentSnapshot];
    setCanvasPresentation(next.presentation ?? "auto");
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedId(current =>
      next.nodes.some(node => node.id === current) ? current : null
    );
    setSelectedEdgeId(current =>
      next.edges.some(edge => edge.id === current) ? current : null
    );
    setHistoryState({
      canUndo: true,
      canRedo: futureRef.current.length > 0,
    });
    toast.info("已重做操作");
  }, [readOnly, setEdges, setNodes]);

  const onNodeDragStart = useCallback((_event: any, node: CanvasNode) => {
    if (readingActiveRef.current) {
      readingDragRef.current = { nodes: structuredClone(latestNodesRef.current), edges: structuredClone(latestEdgesRef.current), presentation: presentationRef.current };
      setNodes(displayedNodesRef.current.map(n => ({ ...n, position: { ...n.position } })));
      setCanvasPresentation("original");
    }
    dragStartSnapshotRef.current = {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
    };
  }, []);

  const onNodeDragStop = useCallback(
    (_event: any, node: CanvasNode) => {
      if (!dragStartSnapshotRef.current) return;
      const { x, y } = dragStartSnapshotRef.current;
      if (
        Math.abs(node.position.x - x) > 2 ||
        Math.abs(node.position.y - y) > 2
      ) {
        const priorNodes = latestNodesRef.current.map(n =>
          n.id === node.id ? { ...n, position: { x, y } } : n
        );
        const before = readingDragRef.current;
        pushHistory(before?.nodes ?? priorNodes, before?.edges ?? latestEdgesRef.current, before?.presentation ?? presentationRef.current);
      } else if (readingDragRef.current) {
        setNodes(readingDragRef.current.nodes);
        setCanvasPresentation(readingDragRef.current.presentation ?? "auto");
      }
      readingDragRef.current = null;
      setNodes(current => [...current]);
      dragStartSnapshotRef.current = null;
    },
    [pushHistory]
  );

  useEffect(() => {
    if (emittedDefinitionRef.current === definitionSignature) {
      appliedDefinitionRef.current = definitionSignature;
      appliedWorkflowRef.current = workflowId;
      return;
    }
    if (
      appliedWorkflowRef.current === workflowId &&
      appliedDefinitionRef.current === definitionSignature
    )
      return;
    const next = definition ?? defaultDefinition();
    baseRef.current = next;
    appliedWorkflowRef.current = workflowId;
    appliedDefinitionRef.current = definitionSignature;
    setNodes(toFlowNodes(next));
    setEdges(toFlowEdges(next));
    setSelectedId(current =>
      current && next.nodes.some(node => node.id === current) ? current : null
    );
    setSelectedEdgeId(current =>
      current && next.edges.some(edge => edge.id === current) ? current : null
    );
    setDeletedEdge(null);
  }, [definition, definitionSignature, workflowId, setEdges, setNodes]);

  useEffect(() => {
    if (!reactFlow || (workflowId && !definition)) return;
    const fitKey = workflowId ?? "__new_workflow__";
    if (lastInitialFitKeyRef.current === fitKey) return;

    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        void fitCanvas(undefined, undefined, 0)
          .then(applied => {
            if (applied) lastInitialFitKeyRef.current = fitKey;
          });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    compactReadOnlyPreview,
    definition,
    definitionSignature,
    reactFlow,
    workflowId,
    fitCanvas,
  ]);

  const hasInspectorSelection = hasCanvasInspectorSelection(nodes, edges, selectedId, selectedEdgeId);
  const inspectorReveal = useContextReveal<HTMLElement>(selectedId || selectedEdgeId);
  const [highlightRelated, setHighlightRelated] = useState(false);
  const neighborhood = useMemo(() => highlightRelated ? traceWorkflowNeighborhood(nodes.map(node => node.id), edges, selectedId) : null, [highlightRelated, nodes, edges, selectedId]);
  const presentedNodes = useMemo(() => neighborhood ? readingNodes.map(node => ({ ...node, className: `${node.className ?? ""} ${neighborhood.nodes.has(node.id) ? "aiflow-related-node" : "aiflow-unrelated-node"}` })) : readingNodes, [readingNodes, neighborhood]);
  const inspectorExpanded = hasInspectorSelection && inspectorMode !== "compact";
  useEffect(() => {
    if (!reactFlow) return;
    const wasExpanded = previousInspectorExpandedRef.current;
    previousInspectorExpandedRef.current = inspectorExpanded;
    if (!inspectorExpanded || wasExpanded) return;

    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        void fitCanvas(selectedId, selectedEdgeId);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [compactReadOnlyPreview, inspectorExpanded, reactFlow, selectedId, selectedEdgeId, fitCanvas]);

  useEffect(() => {
    const viewport = flowViewportRef.current;
    if (
      !reactFlow ||
      !viewport ||
      typeof ResizeObserver === "undefined"
    )
      return;

    const initialRect = viewport.getBoundingClientRect();
    let previousWidth = initialRect.width;
    let previousHeight = initialRect.height;
    let resizeTimer: number | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const changed =
        Math.abs(rect.width - previousWidth) > 2 ||
        Math.abs(rect.height - previousHeight) > 2;
      previousWidth = rect.width;
      previousHeight = rect.height;
      if (!changed) return;

      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        firstFrame = window.requestAnimationFrame(() => {
          secondFrame = window.requestAnimationFrame(() => {
            void fitCanvas(selectedId, selectedEdgeId);
          });
        });
      }, 120);
    });

    observer.observe(viewport);
    return () => {
      observer.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [compactReadOnlyPreview, reactFlow, fitCanvas, selectedId, selectedEdgeId]);

  useEffect(() => {
    if (!onDefinitionChange || isLayoutAnimatingRef.current || readingDragRef.current) return;
    const next = toDefinition(nodes, edges, baseRef.current);
    const serialized = JSON.stringify(next);
    if (
      matchesWorkflowDefinitionSnapshot(
        JSON.stringify(definition ?? defaultDefinition()),
        next
      )
    ) {
      emittedDefinitionRef.current = serialized;
      return;
    }
    if (emittedDefinitionRef.current === serialized) return;

    emittedDefinitionRef.current = serialized;
    onDefinitionChange(next);
  }, [definition, edges, nodes, onDefinitionChange]);

  useEffect(() => {
    const syncFullscreen = () =>
      setFullscreen(document.fullscreenElement === editorRegionRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const inspect = (event?: Event) => {
      const requestedNodeId = (
        event as CustomEvent<{ nodeId?: string }> | undefined
      )?.detail?.nodeId;
      const currentNodes = latestNodesRef.current;
      const next =
        (requestedNodeId &&
          currentNodes.find(node => node.id === requestedNodeId)) ||
        currentNodes.find(node => !["start", "end"].includes(node.data.kind)) ||
        currentNodes[0];
      if (!next) return;
      setSelectedId(next.id);
      setInspectorMode("normal");
      canvasRegionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      void fitCanvas(next.id);
    };
    window.addEventListener("flow:inspect-node", inspect);
    return () => window.removeEventListener("flow:inspect-node", inspect);
  }, [reactFlow, fitCanvas]);

  useEffect(() => {
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; edgeId?: string; focusInspector?: boolean }>).detail;
      const focusInspector = () => {
        if (detail?.focusInspector) window.requestAnimationFrame(() => inspectorHeadingRef.current?.focus({ preventScroll: true }));
      };
      if (detail?.edgeId) {
        inspectCanvasEdge(detail.edgeId);
        focusInspector();
        return;
      }
      const nodeId = detail?.nodeId;
      if (!nodeId) return;
      const node = latestNodesRef.current.find(item => item.id === nodeId);
      if (!node) return;
      setSelectedId(node.id);
      setSelectedEdgeId(null);
      setInspectorMode("normal");
      canvasRegionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      void fitCanvas(node.id);
      focusInspector();
    };
    window.addEventListener("flow:focus-node", focus);
    return () => window.removeEventListener("flow:focus-node", focus);
  }, [inspectCanvasEdge, reactFlow, fitCanvas]);

  const selected = useMemo(
    () => nodes.find(node => node.id === selectedId),
    [nodes, selectedId]
  );
  const loopLimitValue = (edges.find(edge => edge.id === selectedEdgeId)?.data?.loop as any)?.maxIterations ?? "";
  const loopLimitInvalid = readWorkflowLoopLimit(String(loopLimitValue)) === null;
  const selectedDefinition = selected
    ? FLOW_NODE_DEFINITIONS[selected.data.kind]
    : null;
  const selectedConfig = (selected?.data.config ?? {}) as NodeConfig;
  const selectedServiceNode = Boolean(
    selected && ["http", "rest", "method"].includes(selected.data.kind)
  );
  const serviceEndpoints = trpc.project.serviceEndpoints.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId && selectedServiceNode) }
  );
  const endpointChoices = serviceEndpoints.data ?? [];
  const selectedResourceKey =
    selected && flowType === "data"
      ? (
          {
            source: "assetId",
            table: "assetId",
            edit_sql: "datasourceId",
            sql: "datasourceId",
            udf: "udfId",
          } as Record<string, string>
        )[selected.data.kind]
      : undefined;
  const resourceOptions = trpc.data.resourceOptions.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: Boolean(
        projectId && (selectedResourceKey || selected?.data.kind === "filter")
      ),
      staleTime: 30_000,
    }
  );
  const resourceChoices =
    selectedResourceKey === "assetId"
      ? resourceOptions.data?.assets
      : selectedResourceKey === "datasourceId"
        ? resourceOptions.data?.sources
        : selectedResourceKey === "udfId"
          ? resourceOptions.data?.udfs
          : undefined;
  const selectedResourceChoice=resourceChoices?.find(option=>option.value===selectedConfig[selectedResourceKey ?? ""]);
  const selectedResourceReason=selectedResourceChoice && "reason" in selectedResourceChoice ? String(selectedResourceChoice.reason) : "";
  useEffect(() => {
    participantPreview.reset();
  }, [selectedId]);
  const selectedDefaults = selected
    ? createDefaultNodeConfig(selected.data.kind)
    : {};
  const selectedConfigAssessment = selected
    ? projectId &&
      selectedServiceNode &&
      !String(selectedConfig.endpointRef ?? "").trim()
      ? { state: "partial" as const, error: "请选择当前业务的服务端点。" }
      : projectId &&
          selectedServiceNode &&
          serviceEndpoints.isSuccess &&
          !endpointChoices.some(
            endpoint =>
              endpoint.status === "active" &&
              endpoint.refCode === selectedConfig.endpointRef
          )
        ? {
            state: "partial" as const,
            error: "当前服务端点不存在或已停用，请重新选择已启用端点。",
          }
        : projectId &&
            selectedResourceKey &&
            resourceOptions.isSuccess &&
            !resourceChoices?.some(
              option =>
                option.value === selectedConfig[selectedResourceKey] &&
                !("disabled" in option && option.disabled)
            )
          ? {
              state: "partial" as const,
              error:
                selectedResourceReason || "请选择当前项目的可用资源；资源可能已删除、停用或尚未通过审核。",
            }
          : assessNodeConfig(selected.data.kind, selectedConfig)
    : null;
  const selectedConfigState = selectedConfigAssessment?.state;
  const selectedFieldGroups =
    selected && selectedDefinition
      ? configFieldGroups(
          selected.data.kind,
          selectedDefinition.fields,
          selectedConfig
        )
      : [];
  const activeInspectorGroup =
    selectedFieldGroups.find(group => group.label === inspectorTab) ??
    selectedFieldGroups[0];
  const inspectorDisabled = readOnly || inspectorLocked;
  const nodeMap = useMemo(
    () => new Map(nodes.map(node => [node.id, node])),
    [nodes]
  );
  const selectedRouteTargetLabels = useMemo(
    () =>
      edges
        .filter(edge => edge.source === selectedId)
        .reduce<Record<string, string>>(
          (labels, edge) => {
            const handle = edge.sourceHandle || "default";
            const target = String(
              nodeMap.get(edge.target)?.data.label || edge.target
            );
            labels[handle] = labels[handle]
              ? `${labels[handle]}、${target}`
              : target;
            return labels;
          },
          Object.create(null) as Record<string, string>
        ),
    [edges, nodeMap, selectedId]
  );
  const displayedEdges = useMemo(
    () =>
      edges.map(edge => {
        const source = nodeMap.get(edge.source);
        const routes =
          source?.data.kind === "router"
            ? normalizeReferenceRouterConfig(source.data.config).rules.map(
                rule => ({ handle: rule.handle, label: rule.name })
              )
            : [];
        const route = routes.find(
          item =>
            String(item.handle ?? "default") ===
            String(edge.sourceHandle ?? "default")
        );
        const operateOutcome =
          source?.data.kind === "operate"
            ? readOperateOutcomes(source.data.config).find(
                item =>
                  item.sourceHandle === String(edge.sourceHandle ?? "default")
              )
            : undefined;
        const label =
          source?.data.kind === "router"
            ? String(route?.label ?? edge.sourceHandle ?? "默认路径")
            : source?.data.kind === "operate" && operateOutcome
              ? operateOutcome.label
              : source?.data.kind === "llm" && edge.sourceHandle !== "default"
                ? `失败：${edge.sourceHandle}`
                : undefined;
        const isOperateRejected =
          source?.data.kind === "operate" &&
          (edge.sourceHandle === "rejected" ||
            operateOutcome?.code === "rejected");
        const isOperateApproved =
          source?.data.kind === "operate" &&
          (edge.sourceHandle === "approved" ||
            operateOutcome?.code === "approved");
        const outcomeStroke = isOperateRejected
          ? "#ef4444"
          : isOperateApproved
            ? "#10b981"
            : undefined;

        return edge.id === selectedEdgeId
          ? {
              ...edge,
              label,
              data: { ...edge.data, outcomeColor: outcomeStroke },
              selected: true,
              animated: true,
              interactionWidth: 24,
              labelStyle: {
                fill: isOperateRejected
                  ? "#dc2626"
                  : isOperateApproved
                    ? "#059669"
                    : "#5b21b6",
                fontSize: 14,
                fontWeight: 600,
              },
              labelBgStyle: {
                fill: isOperateRejected
                  ? "#fef2f2"
                  : isOperateApproved
                    ? "#ecfdf5"
                    : "#f5f3ff",
                fillOpacity: 0.96,
              },
              labelBgPadding: [5, 3] as [number, number],
              labelBgBorderRadius: 6,
              style: {
                ...edge.style,
                stroke: isOperateRejected
                  ? "#dc2626"
                  : isOperateApproved
                    ? "#059669"
                    : "#4f46e5",
                strokeWidth: 3,
              },
            }
          : {
              ...edge,
              label,
              data: { ...edge.data, outcomeColor: outcomeStroke },
              selected: false,
              interactionWidth: 24,
              labelStyle: {
                fill: isOperateRejected
                  ? "#ef4444"
                  : isOperateApproved
                    ? "#059669"
                    : "#6d28d9",
                fontSize: 14,
                fontWeight: 600,
              },
              labelBgStyle: { fill: "#ffffff", fillOpacity: 0.94 },
              labelBgPadding: [5, 3] as [number, number],
              labelBgBorderRadius: 6,
              style: outcomeStroke
                ? { ...edge.style, stroke: outcomeStroke }
                : edge.style,
            };
      }),
    [edges, nodeMap, selectedEdgeId]
  );
  const canvasRects = useMemo(() => canvasNodeRects(readingNodes), [readingNodes]);
  const workspaceEdges = useMemo(() => displayedEdges.map((edge, canvasLane) => ({ ...edge, type: "workspace", data: { ...edge.data, canvasRects, canvasLane } })), [displayedEdges, canvasRects]);
  const presentedEdges = useMemo(() => neighborhood ? workspaceEdges.map(edge => ({ ...edge, className: `${edge.className ?? ""} ${neighborhood.edges.has(edge.id) ? "aiflow-related-edge" : "aiflow-unrelated-edge"}` })) : workspaceEdges, [workspaceEdges, neighborhood]);

  useEffect(() => {
    setInspectorTab(selectedFieldGroups[0]?.label ?? "");
  }, [selectedId]);

  const addNode = (item: (typeof palette)[number]) => {
    if (readOnly) return;
    if (!isFlowNodeAllowed(flowType, item.type)) {
      toast.error("当前流程类型不支持此节点，请切换到适用的流程。");
      return;
    }
    pushHistory();
    const suffix = Math.random().toString(36).slice(2, 7);
    setNodes(current =>
      current.concat({
        id: `${item.type}-${suffix}`,
        type: "workflowNode",
        position: {
          x: 260 + current.length * 26,
          y: 100 + (current.length % 4) * 95,
        },
        data: {
          label: item.label,
          kind: item.type,
          config: createDefaultNodeConfig(item.type),
        },
      })
    );
  };

  const addReusableNode = (input: {
    type: NodeKind;
    label: string;
    config: NodeConfig;
  }) => {
    if (readOnly) return;
    if (!isFlowNodeAllowed(flowType, input.type)) {
      toast.error("当前流程类型不支持此节点，请切换到适用的流程。");
      return;
    }
    pushHistory();
    const suffix = Math.random().toString(36).slice(2, 7);
    setNodes(current =>
      current.concat({
        id: `${input.type}-${suffix}`,
        type: "workflowNode",
        position: {
          x: 260 + current.length * 26,
          y: 100 + (current.length % 4) * 95,
        },
        data: {
          label: input.label,
          kind: input.type,
          config: structuredClone(input.config),
        },
      })
    );
    setSelectedId(`${input.type}-${suffix}`);
    setSelectedEdgeId(null);
    setInspectorMode("normal");
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const removeNode = useCallback(
    (nodeId: string) => {
      if (readOnly || nodeId === "start" || nodeId === "end") return;
      pushHistory();
      const nextEdges = edges.filter(
        edge => edge.source !== nodeId && edge.target !== nodeId
      );
      setNodes(current =>
        syncRouterRouteTargets(
          current.filter(node => node.id !== nodeId),
          nextEdges
        )
      );
      setEdges(nextEdges);
      setSelectedId(current => (current === nodeId ? null : current));
      setSelectedEdgeId(null);
      setContextMenu(null);
    },
    [edges, pushHistory, readOnly, setEdges, setNodes]
  );

  const deleteSelectedNodes = useCallback(() => {
    if (readOnly) return;
    const ids = nodes
      .filter(
        node => node.selected && !["start", "end"].includes(node.data.kind)
      )
      .map(node => node.id);
    if (!ids.length) return;
    if (
      !window.confirm("是否批量删除框选中的节点？删除后不可恢复，请谨慎操作！")
    )
      return;
    pushHistory();
    const idSet = new Set(ids);
    const nextEdges = edges.filter(
      edge => !idSet.has(edge.source) && !idSet.has(edge.target)
    );
    setNodes(current =>
      syncRouterRouteTargets(
        current.filter(node => !idSet.has(node.id)),
        nextEdges
      )
    );
    setEdges(nextEdges);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, [edges, nodes, pushHistory, readOnly, setEdges, setNodes]);

  const alignSelectedNodes = useCallback(
    (axis: "X" | "Y", anchorId: string) => {
      if (readOnly) return;
      const selectedNodes = nodes.filter(node => node.selected);
      if (selectedNodes.length < 2) return;
      const anchor = nodes.find(node => node.id === anchorId);
      if (!anchor) return;
      pushHistory();
      const value = axis === "X" ? anchor.position.x : anchor.position.y;
      setNodes(current =>
        current.map(node =>
          node.selected
            ? {
                ...node,
                position: {
                  ...node.position,
                  [axis === "X" ? "x" : "y"]: value,
                },
              }
            : node
        )
      );
      setContextMenu(null);
    },
    [nodes, pushHistory, readOnly, setNodes]
  );

  const addContextNode = useCallback(
    (item: (typeof palette)[number], sourceId: string) => {
      if (readOnly) return;
      const source = nodes.find(node => node.id === sourceId);
      if (!source) return;
      pushHistory();
      const suffix = Math.random().toString(36).slice(2, 7);
      const nodeId = `${item.type}-${suffix}`;
      const nextNode: CanvasNode = {
        id: nodeId,
        type: "workflowNode",
        position: { x: source.position.x + 250, y: source.position.y },
        data: {
          label: item.label,
          kind: item.type,
          config: createDefaultNodeConfig(item.type),
        },
      };
      if (!canConnectCanvasNodes(source, nextNode, edges, flowType)) {
        setContextMenu(null);
        return;
      }
      const sourceHandle =
        source.data.kind === "condition"
          ? readConditionHandles(source.data.config)[0]
          : source.data.kind === "router"
            ? String(source.data.config.defaultRoute ?? "default")
            : source.data.kind === "operate" &&
                readOperateOutcomeMode(source.data.config) === "explicit"
              ? (readOperateOutcomes(source.data.config)[0]?.sourceHandle ??
                "default")
              : "default";
      const nextEdge: Edge = {
        id: `edge-${Date.now()}`,
        source: sourceId,
        sourceHandle,
        target: nodeId,
        targetHandle: "target",
        animated: false,
        interactionWidth: 24,
        style: { stroke: "#64748b", strokeWidth: 2 },
      };
      setNodes(current =>
        syncRouterRouteTargets(
          current.concat(nextNode),
          edges.concat(nextEdge),
          source.data.kind === "router" ? source.id : undefined
        )
      );
      setEdges(current => current.concat(nextEdge));
      setSelectedId(nodeId);
      setSelectedEdgeId(null);
      setContextMenu(null);
    },
    [edges, nodes, readOnly, setEdges, setNodes, flowType]
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !connection.source || !connection.target) return;
      const source = nodes.find(node => node.id === connection.source);
      const target = nodes.find(node => node.id === connection.target);
      if (
        !source ||
        !target ||
        !canConnectCanvasNodes(source, target, edges, flowType)
      )
        return;
      pushHistory();
      const nextEdge = {
        ...connection,
        id: "edge-" + Date.now(),
        targetHandle: "target",
        data: { loop: source.id === target.id && flowType !== "data" ? { maxIterations: 3 } : null },
        animated: false,
        interactionWidth: 24,
        style: { stroke: "#64748b", strokeWidth: 2 },
      } as Edge;
      const nextEdges = addEdge(nextEdge, edges);
      setEdges(current =>
        current.some(
          edge =>
            edge.source === nextEdge.source &&
            edge.target === nextEdge.target &&
            (edge.sourceHandle || "default") ===
              (nextEdge.sourceHandle || "default")
        )
          ? current
          : nextEdges
      );
      if (source.data.kind === "router")
        setNodes(current =>
          syncRouterRouteTargets(current, nextEdges, connection.source)
        );
    },
    [edges, nodes, pushHistory, readOnly, setEdges, setNodes, flowType]
  );

  const deleteSelectedEdge = useCallback(() => {
    if (readOnly || !selectedEdgeId) return;
    pushHistory();
    setEdges(current => {
      const edge = current.find(item => item.id === selectedEdgeId);
      if (edge) setDeletedEdge(edge);
      const next = current.filter(item => item.id !== selectedEdgeId);
      const router = edge
        ? nodes.find(
            node => node.id === edge.source && node.data.kind === "router"
          )
        : undefined;
      if (router)
        setNodes(existing => syncRouterRouteTargets(existing, next, router.id));
      return next;
    });
    setSelectedEdgeId(null);
  }, [nodes, pushHistory, readOnly, selectedEdgeId, setEdges, setNodes]);
  const updateSelectedEdgeLoop = (maxIterations: number | undefined | null) => {
    if (inspectorDisabled || !selectedEdgeId || flowType === "data") return;
    pushHistory();
    setEdges(current => current.map(edge => edge.id === selectedEdgeId ? {
      ...edge, data: { ...edge.data, loop: maxIterations === null ? null : { maxIterations } },
    } : edge));
  };

  const undoDeletedEdge = useCallback(() => {
    if (readOnly || !deletedEdge) return;
    if (
      !nodes.some(node => node.id === deletedEdge.source) ||
      !nodes.some(node => node.id === deletedEdge.target)
    ) {
      setDeletedEdge(null);
      return;
    }
    pushHistory();
    const nextEdges = edges.some(edge => edge.id === deletedEdge.id)
      ? edges
      : edges.concat(deletedEdge);
    setEdges(nextEdges);
    setNodes(current => syncRouterRouteTargets(current, nextEdges));
    setSelectedEdgeId(deletedEdge.id);
    setSelectedId(null);
    setDeletedEdge(null);
  }, [deletedEdge, edges, nodes, pushHistory, readOnly, setEdges, setNodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      )
        return;

      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key.toLowerCase() === "z" && !event.shiftKey) {
          event.preventDefault();
          undo();
          return;
        }
        if (
          event.key.toLowerCase() === "y" ||
          (event.key.toLowerCase() === "z" && event.shiftKey)
        ) {
          event.preventDefault();
          redo();
          return;
        }
      }

      if (event.key === "Escape") {
        if (!inspectorLocked) {
          setSelectedId(null);
          setSelectedEdgeId(null);
          setNodes(current =>
            current.map(node => ({ ...node, selected: false }))
          );
          setContextMenu(null);
        }
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (readOnly) return;
      if (
        !selectedEdgeId &&
        !nodes.some(
          node => node.selected && !["start", "end"].includes(node.data.kind)
        )
      )
        return;
      event.preventDefault();
      if (selectedEdgeId) deleteSelectedEdge();
      else deleteSelectedNodes();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    deleteSelectedEdge,
    deleteSelectedNodes,
    inspectorLocked,
    nodes,
    readOnly,
    redo,
    selectedEdgeId,
    undo,
  ]);

  const selectedNodes = useMemo(
    () => nodes.filter(node => node.selected),
    [nodes]
  );
  const onNodeSelectionClick = useCallback(
    (event: React.MouseEvent, node: CanvasNode) => {
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      setNodes(current =>
        current.map(item =>
          additive
            ? item.id === node.id
              ? { ...item, selected: !item.selected }
              : item
            : { ...item, selected: item.id === node.id }
        )
      );
      setSelectedId(node.id);
      setSelectedEdgeId(null);
      setContextMenu(null);
      setInspectorMode(current => (current === "compact" ? "normal" : current));
      if (!additive) revealInspector();
    },
    [revealInspector, setNodes]
  );

  const handleCanvasDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (readOnly) return;
      const type = event.dataTransfer.getData(
        "application/x-aiflow-node"
      ) as NodeKind;
      if (!type || !FLOW_NODE_DEFINITIONS[type]) return;
      const position = reactFlow?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }) ?? { x: 160, y: 160 };
      const suffix = Math.random().toString(36).slice(2, 7);
      const dropped: CanvasNode = {
        id: type + "-" + suffix,
        type: "workflowNode",
        position,
        data: {
          label: FLOW_NODE_DEFINITIONS[type].label,
          kind: type,
          config: createDefaultNodeConfig(type),
        },
      };
      pushHistory();
      setNodes(current => current.concat(dropped));
      setSelectedId(dropped.id);
      setContextMenu(null);
    },
    [pushHistory, reactFlow, readOnly, setNodes]
  );

  const handlePaletteDragStart = useCallback(
    (event: React.DragEvent, item: (typeof palette)[number]) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-aiflow-node", item.type);
      event.dataTransfer.setData("node-type", item.type);
      event.dataTransfer.setData("node-label", item.label);
    },
    []
  );
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: CanvasNode) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = canvasRegionRef.current?.getBoundingClientRect();
      if (node.selected && selectedNodes.length > 1) {
        setContextMenu({
          kind: "group",
          nodeId: node.id,
          x: event.clientX - (bounds?.left ?? 0),
          y: event.clientY - (bounds?.top ?? 0),
        });
      } else {
        setNodes(current =>
          current.map(item => ({ ...item, selected: item.id === node.id }))
        );
        setSelectedId(node.id);
        setSelectedEdgeId(null);
        setContextMenu({
          kind: "node",
          nodeId: node.id,
          x: event.clientX - (bounds?.left ?? 0),
          y: event.clientY - (bounds?.top ?? 0),
        });
      }
    },
    [selectedNodes, setNodes]
  );
  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedEdgeId(edge.id);
      setSelectedId(null);
      const bounds = canvasRegionRef.current?.getBoundingClientRect();
      setContextMenu({
        kind: "edge",
        edgeId: edge.id,
        x: event.clientX - (bounds?.left ?? 0),
        y: event.clientY - (bounds?.top ?? 0),
      });
    },
    []
  );
  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const bounds = canvasRegionRef.current?.getBoundingClientRect();
      setSelectedId(null);
      setSelectedEdgeId(null);
      if (selectedNodes.length > 1) {
        setContextMenu({
          kind: "group",
          x: event.clientX - (bounds?.left ?? 0),
          y: event.clientY - (bounds?.top ?? 0),
        });
      } else {
        setContextMenu({
          kind: "pane",
          x: event.clientX - (bounds?.left ?? 0),
          y: event.clientY - (bounds?.top ?? 0),
        });
      }
    },
    [selectedNodes]
  );
  const onNodeDoubleClick = useCallback(
    (event: React.MouseEvent, node: CanvasNode) => {
      event.preventDefault();
      event.stopPropagation();
      if (node.data.kind !== "start" && node.data.kind !== "end") {
        setSelectedId(node.id);
        setSelectedEdgeId(null);
        setInspectorMode("normal");
      }
    },
    []
  );
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: MouseEvent) => {
      if (
        !(event.target as HTMLElement | null)?.closest(
          "[data-flow-context-menu]"
        )
      )
        setContextMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [contextMenu]);
  const updateSelected = (updates: Partial<FlowNodeData>) => {
    if (!selectedId || inspectorDisabled) return;
    if (
      selected?.data.kind === "llm" &&
      updates.config &&
      updates.config.failureHandle !== selected.data.config.failureHandle
    ) {
      try {
        const nextEdges = updateLlmConnections(
          selectedId,
          selected.data.config,
          updates.config,
          edges
        );
        pushHistory();
        setEdges(nextEdges);
        setNodes(current =>
          current.map(node =>
            node.id === selectedId
              ? { ...node, data: { ...node.data, ...updates } }
              : node
          )
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "LLM 失败分支更新失败。"
        );
      }
      return;
    }
    if (
      selected?.data.kind === "operate" &&
      updates.config &&
      (updates.config.outcomes !== selected.data.config.outcomes ||
        updates.config.outcomeMode !== selected.data.config.outcomeMode)
    ) {
      try {
        const nextEdges = updateOperateConnections(
          selectedId,
          selected.data.config,
          updates.config,
          edges
        );
        pushHistory();
        setEdges(nextEdges);
        setNodes(current =>
          current.map(node =>
            node.id === selectedId
              ? { ...node, data: { ...node.data, ...updates } }
              : node
          )
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "操作结果更新失败。"
        );
      }
      return;
    }
    if (
      selected?.data.kind === "router" &&
      updates.config &&
      (updates.config.routes !== selected.data.config.routes ||
        updates.config.defaultRoute !== selected.data.config.defaultRoute)
    ) {
      try {
        const next = updateRouterConnections(
          selectedId,
          selected.data.config,
          updates.config,
          edges
        );
        pushHistory();
        setEdges(next.edges);
        setNodes(current =>
          current.map(node =>
            node.id === selectedId
              ? {
                  ...node,
                  data: { ...node.data, ...updates, config: next.config },
                }
              : node
          )
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "路由分支更新失败。"
        );
      }
      return;
    }
    if (selected?.data.kind === "condition" && updates.config) {
      const before = readConditionHandles(selected.data.config);
      const after = readConditionHandles(updates.config);
      if (after[0] === after[1]) {
        toast.error("成立与不成立分支句柄必须不同，请使用不同名称。");
        return;
      }
      if (before[0] !== after[0] || before[1] !== after[1]) {
        pushHistory();
        setEdges(current =>
          current.map(edge => {
            if (edge.source !== selectedId) return edge;
            const branchIndex = before.indexOf(edge.sourceHandle ?? "default");
            return branchIndex < 0
              ? edge
              : { ...edge, sourceHandle: after[branchIndex] };
          })
        );
        setNodes(current =>
          current.map(node =>
            node.id === selectedId
              ? { ...node, data: { ...node.data, ...updates } }
              : node
          )
        );
        return;
      }
    }
    pushHistory();
    setNodes(current =>
      current.map(node =>
        node.id === selectedId
          ? { ...node, data: { ...node.data, ...updates } }
          : node
      )
    );
  };

  const updateConfigFields = (updates: NodeConfig) =>
    updateSelected({ config: { ...selectedConfig, ...updates } });
  const updateConfigField = (key: string, value: unknown) => {
    if (key === "gbms" && selected?.data.kind === "router") {
      updateSelected({
        config: setRouterBroadcast(selectedConfig, Boolean(value)),
      });
      return;
    }
    if (key === "parallelJoinNodeId" && selected) {
      try {
        const changes = bindParallelJoin(
          nodes.map(node => ({ id: node.id, config: node.data.config })),
          selected.id,
          String(value)
        );
        pushHistory();
        setNodes(current =>
          current.map(node =>
            changes[node.id]
              ? { ...node, data: { ...node.data, config: changes[node.id] } }
              : node
          )
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "汇聚节点绑定失败。"
        );
      }
      return;
    }
    updateConfigFields({ [key]: value });
  };

  const showNodePath = useCallback(
    (nodeId: string) => {
      const byId = new Map(nodes.map(node => [node.id, node]));
      const path: string[] = [];
      const visited = new Set<string>();
      let current: string | undefined = nodeId;
      while (
        current &&
        !visited.has(current) &&
        path.length < nodes.length + 1
      ) {
        visited.add(current);
        const node = byId.get(current);
        if (!node) break;
        path.push(String(node.data.label || node.id));
        current = edges.find(edge => edge.source === current)?.target;
      }
      window.alert("流程路径：" + path.join(" → "));
      setContextMenu(null);
    },
    [edges, nodes]
  );
  const exportCanvasImage = () => {
    // UX: exported geometry follows the visible reading projection and routed edges.
    const visibleNodes = displayedNodesRef.current;
    const rects = canvasNodeRects(visibleNodes);
    const routes = latestEdgesRef.current.flatMap((edge, lane) => {
      const a = rects.find(n => n.id === edge.source), b = rects.find(n => n.id === edge.target);
      return a && b ? [{ edge, points: canvasConnectionPoints({ x: a.x + a.width + 4, y: a.y + a.height / 2 }, { x: b.x - 4, y: b.y + b.height / 2 }, rects, edge.source, edge.target, lane) }] : [];
    });
    const bounds = canvasBounds(rects, routes.flatMap(r => r.points));
    const lines = routes.map(({ points }) => `<path d="${roundedCanvasPath(points)}" fill="none" stroke="#71839b" stroke-width="2" marker-end="url(#arrow)"/>`).join("");
    const cards = visibleNodes.map(node => {
      const r = rects.find(rect => rect.id === node.id)!;
      return `<g><title>${escapeXml(node.data.label)}</title><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="10" fill="#ffffff" stroke="#cbd5e1"/><text x="${r.x + 14}" y="${r.y + 36}" fill="#0f172a" font-size="14" font-family="sans-serif" font-weight="600">${escapeXml(node.data.label.slice(0, 16))}</text><text x="${r.x + 14}" y="${r.y + 60}" fill="#64748b" font-size="12" font-family="sans-serif">${escapeXml(FLOW_NODE_DEFINITIONS[node.data.kind].label)}</text></g>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><defs><marker id="arrow" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1 L11 6 L1 11 Z" fill="#71839b"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="100%" height="100%" fill="#f8fafc"/>${lines}${cards}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "flow-canvas.svg";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = async () => {
    if (!editorRegionRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await editorRegionRef.current.requestFullscreen();
    } catch (err) {
      console.warn("[WorkflowCanvas] Fullscreen toggle failed:", err);
    }
  };

  useEffect(() => {
    const focusCanvas = () =>
      canvasRegionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    const clearHighlight = () => {
      setHighlightRelated(false);
      setSelectedId(null);
      setSelectedEdgeId(null);
      setNodes(current => current.map(node => ({ ...node, selected: false })));
      focusCanvas();
    };
    const neatenCanvas = () => {
      const currentNodes = latestNodesRef.current;
      const currentEdges = latestEdgesRef.current;
      if (!currentNodes.length || readOnly) return;

      pushHistory(currentNodes, currentEdges);
      setCanvasPresentation("original");
      const neatNodes = autoLayoutNodes(currentNodes, currentEdges);

      if (
        prefersReducedMotion ||
        currentNodes.length > 80 ||
        currentEdges.length > 150
      ) {
        setNodes(neatNodes);
        if (onDefinitionChange) {
          const nextDef = toDefinition(
            neatNodes,
            currentEdges,
            baseRef.current
          );
          onDefinitionChange(nextDef);
        }
        setTimeout(() => {
          void fitCanvas(undefined, undefined, 0);
        }, 30);
        toast.success("画布已完成自动拓扑排版与间距整理。");
        focusCanvas();
        return;
      }

      if (layoutRafRef.current) cancelAnimationFrame(layoutRafRef.current);
      isLayoutAnimatingRef.current = true;
      const startPositions = new Map(
        displayedNodesRef.current.map(n => [n.id, { ...n.position }])
      );
      const targetPositions = new Map(
        neatNodes.map(n => [n.id, { ...n.position }])
      );
      const duration = 280;
      const startTime = performance.now();
      const easeOutExpo = (t: number) =>
        t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = easeOutExpo(progress);

        setNodes(current =>
          current.map(node => {
            const start = startPositions.get(node.id);
            const target = targetPositions.get(node.id);
            if (!start || !target) return node;
            return {
              ...node,
              position: {
                x: Math.round(start.x + (target.x - start.x) * eased),
                y: Math.round(start.y + (target.y - start.y) * eased),
              },
            };
          })
        );

        if (progress < 1) {
          layoutRafRef.current = requestAnimationFrame(animate);
        } else {
          isLayoutAnimatingRef.current = false;
          layoutRafRef.current = null;
          setNodes(neatNodes);
          if (onDefinitionChange) {
            const nextDef = toDefinition(
              neatNodes,
              currentEdges,
              baseRef.current
            );
            onDefinitionChange(nextDef);
          }
          setTimeout(() => {
            void fitCanvas(undefined, undefined, 250);
          }, 30);
          toast.success("画布已完成自动拓扑排版与间距整理。");
          focusCanvas();
        }
      };

      layoutRafRef.current = requestAnimationFrame(animate);
    };
    const saveCanvasImage = () => {
      exportCanvasImage();
      focusCanvas();
    };
    const fullscreenCanvas = () => {
      void toggleFullscreen();
    };
    window.addEventListener("flow:clear-highlight", clearHighlight);
    window.addEventListener("flow:neaten-canvas", neatenCanvas);
    window.addEventListener("flow:save-canvas-image", saveCanvasImage);
    window.addEventListener("flow:fullscreen-canvas", fullscreenCanvas);
    return () => {
      if (layoutRafRef.current) {
        cancelAnimationFrame(layoutRafRef.current);
        isLayoutAnimatingRef.current = false;
      }
      window.removeEventListener("flow:clear-highlight", clearHighlight);
      window.removeEventListener("flow:neaten-canvas", neatenCanvas);
      window.removeEventListener("flow:save-canvas-image", saveCanvasImage);
      window.removeEventListener("flow:fullscreen-canvas", fullscreenCanvas);
    };
  }, [reactFlow, fullscreen, fitCanvas, readOnly, pushHistory, prefersReducedMotion, onDefinitionChange]);

  const availablePalette = palette.filter(item =>
    isFlowNodeAllowed(flowType, item.type)
  );
  const normalizedNodeSearch = nodePaletteSearch.trim().toLowerCase();
  const visiblePalette = availablePalette.filter(
    item =>
      !normalizedNodeSearch ||
      item.label.toLowerCase().includes(normalizedNodeSearch) ||
      item.description.toLowerCase().includes(normalizedNodeSearch)
  );
  const {
    availableTemplates,
    availableSubflows: enabledSubflows,
    count: reuseCount,
  } = availableWorkflowReuseResources(flowType, templates, subflows);
  const normalizedReuseSearch = reuseSearch.trim().toLowerCase();
  const visibleTemplates = availableTemplates.filter(
    template =>
      !normalizedReuseSearch ||
      template.name.toLowerCase().includes(normalizedReuseSearch)
  );
  const visibleSubflows = enabledSubflows.filter(
    subflow =>
      !normalizedReuseSearch ||
      subflow.name.toLowerCase().includes(normalizedReuseSearch)
  );

  const canvasMinHeight = compactReadOnlyPreview ? "min-h-0" : "min-h-[650px]";

  return (
    <div
      ref={editorRegionRef}
      data-aiflow-workflow-canvas=""
      data-canvas-redesign=""
      data-reading-layout={readingActive ? "true" : "false"}
      data-workflow-editor={compactReadOnlyPreview ? undefined : ""}
      data-editor-viewport={viewportFit ? "true" : undefined}
      data-inspector-mode={inspectorMode}
      style={editorViewportStyle}
      className={`grid min-w-0 max-w-full grid-cols-1 bg-card ${fullscreen ? `h-[100dvh] min-h-0 overflow-y-auto lg:overflow-hidden ${hasInspectorSelection && inspectorMode === "compact" ? "lg:grid-rows-[minmax(0,1fr)_auto]" : "lg:grid-rows-[minmax(0,1fr)]"}` : `${canvasMinHeight} overflow-hidden rounded-xl border border-border shadow-2xs`} ${
        !hasInspectorSelection || inspectorMode === "compact"
          ? ""
          : inspectorMode === "maximized"
            ? "lg:grid-cols-[minmax(0,1fr)_min(55%,620px)]"
            : viewportFit ? "lg:grid-cols-[minmax(0,1fr)_clamp(280px,32%,400px)]" : "lg:grid-cols-[minmax(0,1fr)_420px]"
      }`}
    >
      <section
        ref={canvasRegionRef}
        tabIndex={-1}
        style={{ scrollMarginTop: fullscreen ? "1rem" : viewportFit ? "calc(var(--workspace-header-height,56px) + var(--aiflow-command-height,0px) + 24px)" : "4rem" }}
        className={
          fullscreen
            ? "relative min-h-0 min-w-0 bg-muted flex flex-col lg:h-full"
            : "relative min-w-0 bg-muted flex flex-col"
        }
      >
        <div
          data-flow-canvas-toolbar=""
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card p-2"
        >
          {!readOnly && (
            <div data-flow-node-palette="" className="contents">
              <Popover
                open={paletteOpen === "nodes"}
                onOpenChange={open => changePalette("nodes", open)}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-canvas-palette-trigger=""
                  >
                    <Plus size={14} />
                    添加节点
                    <span className="aiflow-type-meta rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                      {availablePalette.length}
                    </span>
                    <span aria-hidden="true" className={canvasMutedTextClass}>
                      ▾
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  aria-label="添加流程节点"
                  align="start"
                  collisionPadding={12}
                  onCloseAutoFocus={closePaletteFocus}
                  data-node-palette-popup=""
                >
                  <label className={canvasStackedLabelClass}>
                    搜索节点
                    <input
                      type="search"
                      className={canvasSelectClass}
                      placeholder="输入节点名称或用途"
                      value={nodePaletteSearch}
                      onChange={event => setNodePaletteSearch(event.target.value)}
                    />
                  </label>
                  <p className={canvasSectionHelpClass}>
                    拖拽或单击添加节点。
                  </p>
                  {visiblePalette.length ? (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {visiblePalette.map(item => (
                        <Button
                          key={item.type}
                          type="button"
                          variant="ghost"
                          className="h-auto min-h-12 justify-start gap-2 rounded-lg border border-border px-2.5 py-2 text-left hover:border-aiflow-info-border hover:bg-aiflow-info-surface/50"
                          disabled={readOnly}
                          draggable={!readOnly}
                          aria-label={"添加" + item.label + "：" + item.description}
                          onDragStart={event => handlePaletteDragStart(event, item)}
                          onClick={() => addNode(item)}
                          title={item.description}
                        >
                          <NodeTypeGlyph
                            icon={item.icon}
                            color={item.color}
                            size="palette"
                          />
                          <span className="min-w-0">
                            <span className="aiflow-type-body block truncate font-semibold text-foreground">
                              {item.label}
                            </span>
                            <span className="aiflow-type-body mt-0.5 block line-clamp-2 text-muted-foreground">
                              {item.description}
                            </span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="aiflow-type-body mt-3 rounded-md bg-muted p-4 text-center text-muted-foreground">
                      没有匹配的节点。
                    </p>
                  )}
                  {(flowType === "state" || flowType === "control") && (
                    <p className="aiflow-type-body mt-3 border-t border-border pt-2 text-muted-foreground">
                      业务资源与物理资源节点尚未接入当前项目。
                    </p>
                  )}
                </PopoverContent>
              </Popover>
              {reuseCount > 0 && (
                <Popover
                  open={paletteOpen === "reuse"}
                  onOpenChange={open => changePalette("reuse", open)}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-canvas-palette-trigger=""
                    >
                      <FolderTree size={14} />
                      复用资源
                      <span className="aiflow-type-meta rounded bg-aiflow-special-surface px-1.5 py-0.5 font-mono text-aiflow-special">
                        {reuseCount}
                      </span>
                      <span aria-hidden="true" className={canvasMutedTextClass}>
                        ▾
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    aria-label="复用流程资源"
                    align="start"
                    collisionPadding={12}
                    onCloseAutoFocus={closePaletteFocus}
                    data-node-palette-popup=""
                  >
                    <label className={canvasStackedLabelClass}>
                      搜索可复用资源
                      <input
                        type="search"
                        className={canvasSelectClass}
                        placeholder="输入模板或子流程名称"
                        value={reuseSearch}
                        onChange={event => setReuseSearch(event.target.value)}
                      />
                    </label>
                    <div className="mt-3 grid gap-3">
                      {visibleTemplates.length > 0 && (
                        <section>
                          <h3 className={canvasSectionTitleClass}>
                            节点模板
                          </h3>
                          <div className={canvasConfigGridClass}>
                            {visibleTemplates.map(template => (
                              <Button
                                key={template.id}
                                type="button"
                                variant="outline"
                                className="aiflow-type-control h-11 min-h-11 justify-start gap-2 truncate min-[1024px]:h-9 min-[1024px]:min-h-0"
                                aria-label={`添加节点模板：${template.name}`}
                                title={template.name}
                                onClick={() =>
                                  addReusableNode({
                                    type: template.nodeType,
                                    label: template.name,
                                    config: template.config,
                                  })
                                }
                              >
                                <Save
                                  size={13}
                                  className="shrink-0 text-muted-foreground"
                                />
                                <span className="truncate">{template.name}</span>
                              </Button>
                            ))}
                          </div>
                        </section>
                      )}
                      {visibleSubflows.length > 0 && (
                        <section>
                          <h3 className={canvasSectionTitleClass}>
                            可用子流程
                          </h3>
                          <div className={canvasConfigGridClass}>
                            {visibleSubflows.map(subflow => (
                              <Button
                                key={subflow.id}
                                type="button"
                                variant="outline"
                                className="aiflow-type-control h-11 min-h-11 justify-start gap-2 truncate border-aiflow-special-border text-aiflow-special hover:bg-aiflow-special-surface min-[1024px]:h-9 min-[1024px]:min-h-0"
                                aria-label={`添加子流程：${subflow.name}`}
                                title={subflow.name}
                                onClick={() =>
                                  addReusableNode({
                                    type: "subflow",
                                    label: subflow.name,
                                    config: {
                                      subflowId: subflow.id,
                                      input: "{{input}}",
                                    },
                                  })
                                }
                              >
                                <FolderTree size={13} className="shrink-0" />
                                <span className="truncate">{subflow.name}</span>
                              </Button>
                            ))}
                          </div>
                        </section>
                      )}
                      {!visibleTemplates.length && !visibleSubflows.length && (
                        <p className="aiflow-type-body rounded-md bg-muted p-4 text-center text-muted-foreground">
                          没有匹配的模板或子流程。
                        </p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
          {showCanvasActions && (
            <div data-flow-canvas-actions="" className="contents">
              {!readOnly && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-canvas-icon=""
                    aria-label="撤销"
                    disabled={!historyState.canUndo}
                    onClick={undo}
                    title="撤销操作 (Ctrl+Z / ⌘Z)"
                  >
                    <RotateCcw size={13} className={canvasMutedTextClass} />

                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-canvas-icon=""
                    aria-label="重做"
                    disabled={!historyState.canRedo}
                    onClick={redo}
                    title="重做操作 (Ctrl+Y / ⌘Y)"
                  >
                    <RotateCw size={13} className={canvasMutedTextClass} />

                  </Button>
                  <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" />
                </>
              )}
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-canvas-icon=""
                  aria-label="整理画布"
                  onClick={() =>
                    window.dispatchEvent(new Event("flow:neaten-canvas"))
                  }
                  title={
                    flowType === "state"
                      ? "整理画布：针对状态机生命周期执行拓扑层级对齐"
                      : "整理画布：执行 DAG 依赖自动排版"
                  }
                >
                  <Waypoints size={13} className={canvasMutedTextClass} />

                </Button>
              )}
              <select
                aria-label="定位并配置节点"
                className="aiflow-type-control h-11 min-w-24 max-w-full flex-1 basis-36 rounded-md border border-border bg-card px-2 text-foreground lg:h-9 lg:max-w-56"
                value={selectedId ?? ""}
                disabled={!nodes.length}
                onChange={event => inspectCanvasNode(event.target.value)}
              >
                <option value="" disabled>
                  选择节点（共 {nodes.length} 个）
                </option>
                {nodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {String(node.data.label || "未命名节点")} ·{" "}
                    {FLOW_NODE_DEFINITIONS[node.data.kind]?.label ?? node.data.kind}{" "}
                    · {node.id}
                  </option>
                ))}
              </select>
              <Popover open={displayOpen} onOpenChange={setDisplayOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="定位与显示"
                    data-canvas-icon=""
                    title="连线定位与节点关联高亮"
                  >
                    <GitBranch size={16} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  aria-label="定位与显示"
                  align="end"
                  collisionPadding={12}
                  className="grid max-h-[var(--radix-popover-content-available-height)] w-[min(360px,calc(100vw-1.5rem))] gap-3 overflow-y-auto"
                  onCloseAutoFocus={event => {
                    if (displayLocationFocus.current) event.preventDefault();
                    displayLocationFocus.current = false;
                  }}
                >
                  <p className="text-sm font-semibold">定位与显示</p>
                  <Button
                    type="button"
                    variant={neighborhood ? "secondary" : "ghost"}
                    size="sm"
                    aria-label="高亮节点关联"
                    aria-pressed={Boolean(neighborhood)}
                    disabled={!selectedId}
                    onClick={() => setHighlightRelated(value => !value)}
                    title="查看选中节点的静态上游与下游连接"
                    className="h-11 gap-1 px-2 min-[1024px]:h-9"
                  >
                    <GitBranch size={15} />
                    关联高亮
                  </Button>
                  <select
                    aria-label="定位并配置连线"
                    className="aiflow-type-control h-11 min-w-0 max-w-full rounded-md border border-border bg-card px-2 text-foreground sm:max-w-64 min-[1024px]:h-9"
                    value={selectedEdgeId ?? ""}
                    disabled={!edges.length}
                    onChange={event => {
                      displayLocationFocus.current = true;
                      setDisplayOpen(false);
                      window.dispatchEvent(
                        new CustomEvent("flow:focus-node", {
                          detail: { edgeId: event.target.value },
                        })
                      );
                    }}
                  >
                    <option value="" disabled>
                      选择连线（共 {edges.length} 条）
                    </option>
                    {edges.map(edge => (
                      <option
                        key={edge.id}
                        value={edge.id}
                      >{`${String(nodeMap.get(edge.source)?.data.label ?? edge.source)} → ${String(nodeMap.get(edge.target)?.data.label ?? edge.target)}${edge.data?.loop ? " · 循环返回" : ""}`}</option>
                    ))}
                  </select>
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-canvas-icon=""
                aria-label={fullscreen ? "退出全屏" : "全屏展示"}
                onClick={() =>
                  window.dispatchEvent(new Event("flow:fullscreen-canvas"))
                }
                title="切换全屏沉浸设计模式"
              >
                <Maximize2 size={13} className={canvasMutedTextClass} />

              </Button>
              {!readOnly && selectedEdgeId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 gap-0 p-0 text-xs text-red-600 hover:bg-red-50 sm:w-auto sm:gap-1 sm:px-2 min-[1024px]:h-9"
                  aria-label="删除连线"
                  onClick={deleteSelectedEdge}
                  title="删除选中的连线（Delete 或 Backspace）"
                >
                  <Trash2 size={13} />
                  <span className="hidden sm:inline">删除连线</span>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="更多画布操作"
                    title="更多画布操作"
                    data-canvas-icon="" className="ml-auto"
                  >
                    <span className="sr-only">更多画布操作</span>
                    <span aria-hidden="true">▾</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem
                    aria-label="保存为图片"
                    className={canvasResponsiveButtonClass}
                    onSelect={() =>
                      window.dispatchEvent(new Event("flow:save-canvas-image"))
                    }
                  >
                    <Download size={16} />
                    <span>保存为图片</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    aria-label="取消高亮"
                    className={canvasResponsiveButtonClass}
                    onSelect={() =>
                      window.dispatchEvent(new Event("flow:clear-highlight"))
                    }
                  >
                    <MousePointer2 size={16} />
                    <span>取消高亮</span>
                  </DropdownMenuItem>
                  {!readOnly && deletedEdge && (
                    <DropdownMenuItem
                      aria-label="撤销删线"
                      className="min-h-11 text-sm text-indigo-600 min-[1024px]:min-h-9"
                      onSelect={undoDeletedEdge}
                    >
                      <RotateCcw size={16} />
                      <span>撤销删线</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <div
          ref={flowViewportRef}
          data-flow-canvas-viewport=""
          className={`relative ${fullscreen ? "h-[480px] shrink-0 sm:h-[600px] lg:min-h-0 lg:h-auto lg:flex-1" : compactReadOnlyPreview ? "h-[340px] sm:h-[420px] lg:h-[520px]" : "h-[480px] sm:h-[600px] lg:h-[calc(100vh-220px)] lg:min-h-[620px]"}`}
          onDragOver={event => event.preventDefault()}
          onDrop={handleCanvasDrop}
        >
          {!compactReadOnlyPreview && <div data-canvas-view-controls="" className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-card p-1 text-xs">
            <button type="button" className="rounded px-2 py-1 hover:bg-muted" onClick={() => { void fitCanvas(); }}>总览</button>
            <button type="button" className="rounded px-2 py-1 hover:bg-muted" disabled={!selectedId} onClick={() => { void fitCanvas(selectedId); }}>上下游</button>
            <button type="button" className="rounded px-2 py-1 hover:bg-muted" title="切换显示布局，不修改已保存坐标" aria-pressed={readingActive} onClick={() => { setCanvasPresentation(readingActive ? "original" : "readable"); window.requestAnimationFrame(() => window.requestAnimationFrame(() => { void fitCanvas(selectedId); })); }}>{readingActive ? "阅读布局" : "原始布局"}</button>
          </div>}
          {!readingActive && canvasHasCrowding(nodes) && <p data-canvas-layout-warning="" role="status" className="absolute bottom-3 left-16 z-10 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">原始节点重叠；切换阅读布局可查看连线，不修改原坐标。</p>}
          <details className="aiflow-type-control absolute left-3 top-3 z-10 rounded-lg border border-border bg-card/95 text-muted-foreground shadow-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center px-3 py-2 font-semibold text-foreground">
              画布说明
            </summary>
            <div className="grid gap-2 border-t border-border px-3 py-2">
              <div className="flex flex-wrap gap-3">
                <span className={canvasIconRowClass}>
                  <i className="h-2 w-2 rounded-full bg-red-500" />
                  未完全配置
                </span>
                <span className={canvasIconRowClass}>
                  <i className="h-2 w-2 rounded-full bg-blue-500" />
                  结构完整（默认）
                </span>
                <span className={canvasIconRowClass}>
                  <i className="h-2 w-2 rounded-full bg-emerald-500" />
                  结构完整
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-muted-foreground">
                <span className={canvasIconRowClass}>
                  <Move size={13} />
                  画布移动
                </span>
                <span className={canvasIconRowClass}>
                  <Maximize2 size={13} />
                  画布缩放
                </span>
                <span className={canvasIconRowClass}>
                  <MousePointer2 size={13} />
                  选择连线
                </span>
                <span className={canvasIconRowClass}>
                  <Square size={12} />
                  节点框选
                </span>
              </div>
            </div>
          </details>
          {contextMenu && (
            <div
              data-flow-context-menu=""
              className="absolute z-50 min-w-44 rounded-md border border-border bg-card py-1 text-xs shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={event => event.stopPropagation()}
            >
              {contextMenu.kind === "node" &&
                contextMenu.nodeId &&
                (() => {
                  const targetNode = nodes.find(
                    node => node.id === contextMenu.nodeId
                  );
                  if (!targetNode) return null;
                  const canDelete =
                    !readOnly &&
                    !["start", "end"].includes(targetNode.data.kind);
                  const allowed =
                    FLOW_NODE_ALLOWED_TARGETS[targetNode.data.kind] ??
                    palette.map(item => item.type);
                  const addable = palette.filter(
                    item =>
                      isFlowNodeAllowed(flowType, item.type) &&
                      allowed.includes(item.type) &&
                      item.type !== "start"
                  );
                  return (
                    <>
                      {!["start", "end"].includes(targetNode.data.kind) && (
                        <button
                          type="button"
                          className={canvasMenuItemClass}
                          onClick={() => {
                            setInspectorMode("normal");
                            setSelectedId(targetNode.id);
                            closeContextMenu();
                          }}
                        >
                          编辑 / 查看配置
                        </button>
                      )}
                      {(targetNode.data.kind === "start" ||
                        targetNode.data.kind === "end") &&
                        targetNode.data.label !== "默认开始" &&
                        !readOnly && (
                          <button
                            type="button"
                            className={canvasMenuItemClass}
                            onClick={() => {
                              setNameDialog({
                                title: "修改节点名称",
                                initialName: String(targetNode.data.label),
                                onSave: name =>
                                  setNodes(current =>
                                    current.map(item =>
                                      item.id === targetNode.id
                                        ? {
                                            ...item,
                                            data: { ...item.data, label: name },
                                          }
                                        : item
                                    )
                                  ),
                              });
                              closeContextMenu();
                            }}
                          >
                            修改名称
                          </button>
                        )}
                      <button
                        type="button"
                        className={canvasMenuItemClass}
                        onClick={() => {
                          navigator.clipboard
                            ?.writeText(targetNode.id)
                            .catch(() => undefined);
                          closeContextMenu();
                        }}
                      >
                        查看节点编号
                      </button>
                      <button
                        type="button"
                        className={canvasMenuItemClass}
                        onClick={() => showNodePath(targetNode.id)}
                      >
                        查看路径
                      </button>
                      <div className="my-1 border-t border-border" />
                      {!readOnly && targetNode.data.kind !== "end" && (
                        <div className="aiflow-type-control px-3 py-1 font-semibold text-muted-foreground">
                          在此节点后添加
                        </div>
                      )}
                      {!readOnly &&
                        targetNode.data.kind !== "end" &&
                        addable.slice(0, 8).map(item => (
                          <button
                            key={item.type}
                            type="button"
                            className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                            onClick={() => addContextNode(item, targetNode.id)}
                          >
                            添加{item.label}
                          </button>
                        ))}
                      {canDelete && (
                        <>
                          <div className="my-1 border-t border-border" />
                          <button
                            type="button"
                            className={canvasDangerMenuItemClass}
                            onClick={() => removeNode(targetNode.id)}
                          >
                            删除节点
                          </button>
                        </>
                      )}
                    </>
                  );
                })()}
              {contextMenu.kind === "group" && (
                <>
                  <button
                    type="button"
                    className={canvasMenuItemClass}
                    onClick={() =>
                      alignSelectedNodes(
                        "X",
                        contextMenu.nodeId || selectedNodes[0]?.id || ""
                      )
                    }
                  >
                    横向对齐
                  </button>
                  <button
                    type="button"
                    className={canvasMenuItemClass}
                    onClick={() =>
                      alignSelectedNodes(
                        "Y",
                        contextMenu.nodeId || selectedNodes[0]?.id || ""
                      )
                    }
                  >
                    竖向对齐
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      className={canvasDangerMenuItemClass}
                      onClick={deleteSelectedNodes}
                    >
                      批量删除
                    </button>
                  )}
                  <button
                    type="button"
                    className={canvasMenuItemClass}
                    onClick={() => {
                      setNodes(current =>
                        current.map(node => ({ ...node, selected: false }))
                      );
                      closeContextMenu();
                    }}
                  >
                    取消框选
                  </button>
                </>
              )}{" "}
              {contextMenu.kind === "edge" &&
                contextMenu.edgeId &&
                !readOnly && (
                  <button
                    type="button"
                    className={canvasDangerMenuItemClass}
                    onClick={() => {
                      deleteSelectedEdge();
                      closeContextMenu();
                    }}
                  >
                    删除连线
                  </button>
                )}
              {contextMenu.kind === "pane" && !readOnly && (
                <button
                  type="button"
                  className={canvasMenuItemClass}
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedEdgeId(null);
                    closeContextMenu();
                  }}
                >
                  清除选择
                </button>
              )}
            </div>
          )}{" "}
          <ReactFlow<CanvasNode, Edge>
            nodes={presentedNodes}
            edges={presentedEdges}
            nodeTypes={nodeTypes}
            edgeTypes={canvasEdgeTypes}
            onMove={(_event, viewport) => flowViewportRef.current?.style.setProperty("--canvas-zoom", String(viewport.zoom))}
            onInit={setReactFlow}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeSelectionClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeClick={(event, edge) => {
              event.stopPropagation();
              inspectCanvasEdge(edge.id);
            }}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneClick={() => {
              if (inspectorLocked) return;
              setSelectedId(null);
              setSelectedEdgeId(null);
              setNodes(current =>
                current.map(node => ({ ...node, selected: false }))
              );
              setContextMenu(null);
            }}
            onPaneContextMenu={onPaneContextMenu}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            onNodeDragStart={readOnly ? undefined : onNodeDragStart}
            onNodeDragStop={readOnly ? undefined : onNodeDragStop}
            elementsSelectable
            selectionOnDrag={!readOnly}
            selectionKeyCode="Control"
            multiSelectionKeyCode={["Shift", "Control"]}
            minZoom={0.1}
            maxZoom={1.25}
          >
            <Background color="var(--aiflow-canvas-dot)" gap={24} size={1} />
            <MiniMap
              className={compactReadOnlyPreview ? "hidden" : "hidden md:block"}
              nodeColor={node => colorFor((node.data as FlowNodeData).kind)}
              pannable
              zoomable
            />
            <Controls
              className="flow-canvas-controls"
              showInteractive={!readOnly}
              onFitView={() => { void fitCanvas(); }}
            />
          </ReactFlow>
          {neighborhood && <p data-workflow-neighborhood="" role="status" className="aiflow-type-meta pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-5rem)] rounded-xl border border-border bg-card/95 px-3 py-2 text-muted-foreground">静态连接 · 上游 {neighborhood.upstream.size} 个 · 下游 {neighborhood.downstream.size} 个</p>}
        </div>
      </section>
      {hasInspectorSelection && (
        <aside
          data-workflow-inspector=""
          ref={inspectorReveal}
          className={`border-t border-border bg-card lg:border-l lg:border-t-0 ${fullscreen ? "min-h-0 flex flex-col" : ""}`}
        >
          <div
            data-workflow-inspector-header=""
            className="flex min-h-16 shrink-0 items-center justify-between border-b border-border px-4 py-3"
          >
            <div className={inspectorMode === "compact" ? "hidden" : "min-w-0"}>
              <h2 data-workflow-inspector-heading="" ref={inspectorHeadingRef} tabIndex={-1} className="scroll-mt-20 text-sm font-semibold text-foreground focus:outline-none">
                {selectedEdgeId ? "连线配置" : `${selectedDefinition?.label ?? "节点"}配置`}
              </h2>
              {selected && <p className="aiflow-type-meta mt-0.5 line-clamp-2 break-words text-muted-foreground" title={String(selected.data.label ?? "")}>{selected.data.label}</p>}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button type="button" className="mr-1 min-h-11 rounded px-2 text-sm text-aiflow-info hover:bg-muted lg:hidden" onClick={() => {
                canvasRegionRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
                canvasRegionRef.current?.focus({ preventScroll: true });
              }}>返回画布</button>
              <button
                type="button"
                className={`${inspectorToolClass} ${inspectorLocked ? "text-indigo-600" : ""}`}
                title={inspectorLocked ? "解除面板锁定" : "锁定配置面板"}
                aria-label={inspectorLocked ? "解除面板锁定" : "锁定配置面板"}
                onClick={() => setInspectorLocked(value => !value)}
              >
                <LockKeyhole size={15} />
              </button>
              <button
                type="button"
                className={inspectorToolClass}
                title="最大化面板"
                aria-label="最大化面板"
                onClick={() => setInspectorMode("maximized")}
              >
                <Maximize2 size={15} />
              </button>
              <button
                type="button"
                className={`${inspectorToolClass} ${inspectorMode === "normal" ? "text-slate-300" : ""}`}
                title="恢复配置面板"
                aria-label="恢复配置面板"
                onClick={() => setInspectorMode("normal")}
              >
                <RotateCcw size={15} />
              </button>
              <button
                type="button"
                className={inspectorToolClass}
                title="最小化面板"
                aria-label="最小化面板"
                onClick={() => setInspectorMode("compact")}
              >
                <Minimize2 size={15} />
              </button>
            </div>
          </div>
          {inspectorMode !== "compact" &&
            (selected && selectedDefinition ? (
              <div
                data-workflow-inspector-content=""
                ref={groupNavigation.contentRef}
                className={fullscreen ? "min-h-0 overflow-y-auto lg:flex-1" : "max-h-[650px] overflow-y-auto"}
              >
                <div className="space-y-3 p-4">
                  <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                    节点名称（画布）
                    <input
                      aria-label="节点名称"
                      className="h-9 rounded-lg border border-border px-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-muted"
                      value={String(selected.data.label ?? "")}
                      disabled={inspectorDisabled}
                      onChange={event =>
                        updateSelected({ label: event.target.value })
                      }
                    />
                  </label>
                  <div
                    className={`rounded-lg border px-3 py-2 ${selectedConfigState === "partial" ? "border-red-200 bg-red-50" : selectedConfigState === "editing" ? "border-aiflow-info-border bg-aiflow-info-surface" : "border-aiflow-success-border bg-aiflow-success-surface"}`}
                  >
                    <p className="text-xs font-semibold text-foreground">
                      {selectedDefinition.label} ·{" "}
                      {selectedConfigState === "partial"
                        ? "未完全配置"
                        : selectedConfigState === "editing"
                          ? "结构完整（默认）"
                          : "结构完整"}
                      <span className="font-normal text-muted-foreground"> · 运行前需预检</span>
                      {selected.data.kind === "operate" && readOperateOutcomeMode(selectedConfig) === "legacy_cancel" && (
                        <button type="button" className="ml-2 min-h-11 text-aiflow-warning underline" onClick={() => { setInspectorTab("结果与分支"); groupNavigation.reveal(); }}>兼容分支</button>
                      )}
                    </p>
                    {selectedConfigAssessment?.error && (
                      <p
                        role="status"
                        aria-live="polite"
                        className="aiflow-type-control mt-1 leading-6 text-aiflow-danger"
                      >
                        {selectedConfigAssessment.error}
                      </p>
                    )}
                  </div>
                </div>
                <div
                  role="tablist"
                  ref={groupNavigation.tabsRef}
                  aria-label={`${selectedDefinition.label}配置分类`}
                  className="sticky top-0 z-10 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-1 border-y border-border bg-muted px-3 py-2"
                  onKeyDown={event => {
                    const current = selectedFieldGroups.findIndex(group => group.label === activeInspectorGroup?.label);
                    const target = event.key === "Home" ? 0 : event.key === "End" ? selectedFieldGroups.length - 1 : event.key === "ArrowRight" ? (current + 1) % selectedFieldGroups.length : event.key === "ArrowLeft" ? (current - 1 + selectedFieldGroups.length) % selectedFieldGroups.length : null;
                    if (target === null) return;
                    event.preventDefault();
                    setInspectorTab(selectedFieldGroups[target].label);
                    event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]')[target]?.focus();
                    groupNavigation.reveal();
                  }}
                >
                  {selectedFieldGroups.map(group => (
                    <button
                      key={group.label}
                      type="button"
                      role="tab"
                      id={`${inspectorTabId}-${group.label}`}
                      aria-controls={`${inspectorTabId}-panel`}
                      tabIndex={activeInspectorGroup?.label === group.label ? 0 : -1}
                      aria-selected={
                        activeInspectorGroup?.label === group.label
                      }
                      className={`aiflow-type-control min-h-9 min-w-0 whitespace-normal rounded-md border px-2 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        activeInspectorGroup?.label === group.label
                          ? "border-primary/20 bg-accent text-primary"
                          : "border-transparent text-muted-foreground hover:bg-card hover:text-foreground"
                      }`}
                      onClick={() => { setInspectorTab(group.label); groupNavigation.reveal(); }}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
                {activeInspectorGroup && (
                  <section
                    role="tabpanel"
                    ref={groupNavigation.panelRef}
                    id={`${inspectorTabId}-panel`}
                    aria-labelledby={`${inspectorTabId}-${activeInspectorGroup.label}`}
                    className="min-w-0 px-4 py-4"
                  >
                      {selected.data.kind === "router" &&
                        activeInspectorGroup.label === "兼容规则" && (
                          <p className={canvasSectionHelpClass}>
                            {Array.isArray(selected.data.config.routes) &&
                            selected.data.config.routes.length
                              ? "当前使用“分支规则”；兼容字段不覆盖已有规则。"
                              : "未配置分支规则时使用兼容规则。请优先维护“分支规则”。"}
                          </p>
                        )}
                      {selected.data.kind === "operate" &&
                        activeInspectorGroup.label === "高级配置" && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            兼容对象、身份与自动执行配置。请先设置处理人、表单和结果分支。
                          </p>
                        )}
                  {selected.data.kind === "operate" &&
                    activeInspectorGroup.label === "结果与分支" &&
                    readOperateOutcomeMode(selectedConfig) ===
                      "legacy_cancel" && (
                      <div className="mb-4 aiflow-type-body rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface px-3 py-2 text-aiflow-warning">
                        当前为兼容分支：同意后继续，拒绝即取消实例。切换为显式出口可配置各结果的后续节点。
                      </div>
                    )}
                  {selected.data.kind === "operate" && activeInspectorGroup.label === "处理人" && workflowId && (
                    <div className="mb-4 aiflow-type-body rounded-lg border border-aiflow-info-border bg-aiflow-info-surface px-3 py-3 text-blue-900">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold">参与人解析预览</p>
                          <p className="text-aiflow-info">
                            以当前用户预览；实际运行时重新解析。
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={participantPreview.isPending}
                          onClick={() =>
                            participantPreview.mutate({
                              workflowId,
                              config: selectedConfig,
                            })
                          }
                        >
                          {participantPreview.isPending
                            ? "解析中…"
                            : "预览候选人"}
                        </Button>
                      </div>
                      {participantPreview.data &&
                        participantPreview.variables?.config ===
                          selectedConfig && (
                          <div className="mt-2 rounded border border-aiflow-info-border bg-card/80 px-2 py-1.5">
                            <p>
                              {participantPreview.data.signModeLabel}：
                              {participantPreview.data.totalApprovers}{" "}
                              人参与，需{" "}
                              {participantPreview.data.requiredApprovals}{" "}
                              人通过。
                            </p>
                            <p className="mt-1 break-words">
                              {participantPreview.data.users
                                .map(
                                  (person, index) =>
                                    `${index + 1}. ${person.name}（${person.username}）`
                                )
                                .join("；")}
                              {participantPreview.data.hasMore &&
                                "；仅显示前 100 人"}
                            </p>
                            {participantPreview.data.fallbackApplied && (
                              <p className="text-aiflow-warning">
                                已使用兜底：
                                {participantPreview.data.fallbackApplied === "owner" ? "流程所有者" : "流程发起人"}
                              </p>
                            )}
                          </div>
                        )}
                      {participantPreview.error &&
                        participantPreview.variables?.config ===
                          selectedConfig && (
                          <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">
                            {participantPreview.error.message}
                          </p>
                        )}
                    </div>
                  )}
                    <div className="space-y-4">
                      {activeInspectorGroup.fields.map(field => {
                        const fieldValue =
                          selected.data.kind === "router" &&
                          field.key === "gbms"
                            ? normalizeReferenceRouterConfig(selectedConfig)
                                .broadcast
                            : configFieldValue(field, selectedConfig);
                        if (
                          selected.data.kind === "operate" &&
                          workflowId &&
                          [
                            "assigneeUserId",
                            "assigneeUnitIds",
                            "assigneeRoleCode",
                          ].includes(field.key)
                        ) {
                          const people = field.key === "assigneeUserId";
                          const role = field.key === "assigneeRoleCode";
                          const values =
                            people || role
                              ? fieldValue === undefined ||
                                fieldValue === null ||
                                fieldValue === ""
                                ? []
                                : [String(fieldValue)]
                              : Array.isArray(fieldValue)
                                ? fieldValue.map(String)
                                : [];
                          return (
                            <WorkflowParticipantPicker
                              key={`${workflowId}-${selected.id}-${field.key}`}
                              workflowId={workflowId}
                              kind={
                                people ? "user" : role ? "role" : "department"
                              }
                              value={values}
                              disabled={inspectorDisabled}
                              readOnly={readOnly}
                              onChange={ids =>
                                updateConfigField(
                                  field.key,
                                  role
                                    ? (ids[0] ?? "")
                                    : people
                                      ? ids.length
                                        ? Number(ids[0])
                                        : ""
                                      : ids
                                )
                              }
                            />
                          );
                        }
                        const runtimeOptions =
                          field.key === "parallelJoinNodeId"
                            ? nodes
                                .filter(
                                  node =>
                                    node.id !== selected.id &&
                                    node.data.kind !== "start" &&
                                    node.data.kind !== "router" &&
                                    edges.filter(
                                      edge => edge.target === node.id
                                    ).length >= 2
                                )
                                .map(node => ({
                                  value: node.id,
                                  label: `${node.data.label} · ${FLOW_NODE_DEFINITIONS[node.data.kind].label}`,
                                  disabled: Boolean(
                                    node.data.config.parallelForNodeId &&
                                      node.data.config.parallelForNodeId !==
                                        selected.id
                                  ),
                                }))
                            : projectId && field.key === selectedResourceKey
                              ? (resourceChoices ?? [])
                              : selected.data.kind === "join" &&
                                  [
                                    "leftInputNodeId",
                                    "rightInputNodeId",
                                  ].includes(field.key)
                                ? nodes
                                    .filter(node =>
                                      edges.some(
                                        edge =>
                                          edge.target === selected.id &&
                                          edge.source === node.id
                                      )
                                    )
                                    .map(node => ({
                                      value: node.id,
                                      label: `${node.data.label}（${node.id.slice(0, 8)}）`,
                                    }))
                                : field.key === "endpointRef" && projectId
                                  ? endpointChoices
                                      .filter(
                                        endpoint => endpoint.status === "active"
                                      )
                                      .map(endpoint => ({
                                        value: endpoint.refCode,
                                        label: `${endpoint.name} · ${({ development: "开发", test: "测试", staging: "预发布", production: "生产" } as Record<string, string>)[endpoint.targetEnvironment] ?? endpoint.targetEnvironment}（${endpoint.refCode}）`,
                                      }))
                                  : field.key === "subflowId"
                                    ? subflows
                                        .filter(subflow => subflow.isEnabled)
                                        .map(subflow => ({
                                          value: subflow.id,
                                          label: subflow.name,
                                        }))
                                    : field.key === "compensationNodeId"
                                      ? nodes
                                          .filter(
                                            node =>
                                              node.id !== selected.id &&
                                              canConnectFlowNodeTypes(
                                                selected.data.kind,
                                                node.data.kind
                                              )
                                          )
                                          .map(node => ({
                                            value: node.id,
                                            label: `${node.data.label} · ${FLOW_NODE_DEFINITIONS[node.data.kind].label}（${node.id.slice(0, 8)}）`,
                                          }))
                                      : undefined;
                        return (
                          <ConfigFieldEditor
                            key={`${workflowId ?? ""}-${selected.id}-${selected.data.kind}-${field.key}`}
                            field={
                              selected.data.kind === "router" && field.key === "routes"
                                ? { ...field, help: normalizeReferenceRouterConfig(selectedConfig).broadcast ? "并行：执行全部命中分支，全部到达汇聚节点后继续；未命中时走默认分支。" : "串行：只执行最高优先级的命中分支；未命中时走默认分支。" }
                                : projectId && field.key === selectedResourceKey
                                ? {
                                    ...field,
                                    help:
                                      selectedResourceKey === "datasourceId"
                                        ? "按名称选择已通过连接验证的 MySQL 数据源；请先在业务项目的数据源页面登记并测试连接。"
                                        : selectedResourceKey === "udfId"
                                          ? "选择已审核且绑定内置处理实现的函数；标记“尚不可执行”的函数不能选用。"
                                          : "选择可读取的登记样本或已验证MySQL表；仅登记的API、文件等资源不可用于当前流程读取。",
                                  }
                                : field.key === "endpointRef" && projectId
                                  ? {
                                      ...field,
                                      label: "项目服务端点",
                                      required: true,
                                      help: "选择端点后同步凭据引用。填写相对路径，如 /orders；端点在项目“服务端点”中登记。",
                                    }
                                  : field
                            }
                            value={fieldValue}
                            nodeKind={selected.data.kind}
                            aggregateMetrics={
                              selected.data.kind === "aggregate" &&
                              field.key === "metrics"
                            }
                            fallback={selectedDefaults[field.key]}
                            disabled={
                              inspectorDisabled ||
                              (Boolean(projectId) &&
                                field.key === selectedResourceKey &&
                                resourceOptions.isLoading) ||
                              (field.key === "endpointRef" &&
                                Boolean(projectId) &&
                                serviceEndpoints.isLoading)
                            }
                            fieldSuggestions={
                              usesDataflowInputFieldSuggestions(
                                selected.data.kind,
                                field.key
                              )
                                ? dataflowInputFields(
                                    selected.id,
                                    nodes.map(node => ({
                                      id: node.id,
                                      kind: node.data.kind,
                                      config: node.data.config,
                                    })),
                                    edges,
                                    resourceOptions.data?.assets ?? []
                                  )
                                : undefined
                            }
                            runtimeOptions={runtimeOptions}
                            runtimePlaceholder={
                              field.key === "parallelJoinNodeId"
                                ? "请选择有两条入线的汇聚节点"
                                : projectId && field.key === selectedResourceKey
                                  ? resourceOptions.isLoading
                                    ? "正在加载项目资源…"
                                    : selectedResourceKey === "datasourceId"
                                      ? "请选择已验证的 MySQL 数据源"
                                      : selectedResourceKey === "udfId"
                                        ? "请选择已审核的项目函数"
                                        : "请选择项目数据资源"
                                  : selected.data.kind === "join" &&
                                      [
                                        "leftInputNodeId",
                                        "rightInputNodeId",
                                      ].includes(field.key)
                                    ? "请选择已连接的上游数据节点"
                                    : field.key === "endpointRef" && projectId
                                      ? serviceEndpoints.isLoading
                                        ? "正在加载服务端点…"
                                        : "请选择当前业务的服务端点"
                                      : field.key === "compensationNodeId"
                                        ? "请选择当前流程的补偿节点"
                                        : undefined
                            }
                            runtimeError={
                              projectId && field.key === selectedResourceKey
                                ? resourceOptions.error?.message
                                : field.key === "endpointRef" && projectId
                                  ? serviceEndpoints.error?.message
                                  : undefined
                            }
                            onRetryOptions={
                              projectId && field.key === selectedResourceKey
                                ? () => void resourceOptions.refetch()
                                : field.key === "endpointRef" && projectId
                                  ? () => void serviceEndpoints.refetch()
                                  : undefined
                            }
                            routeTargetLabels={selectedRouteTargetLabels}
                            operateConfig={selectedConfig}
                            outcomeMode={String(
                              selectedConfig.outcomeMode ?? "legacy_cancel"
                            )}
                            onChange={value => {
                              if (field.key === "endpointRef" && projectId) {
                                try {
                                  updateSelected({
                                    config: selectWorkflowEndpoint(
                                      selectedConfig,
                                      String(value),
                                      endpointChoices
                                    ),
                                  });
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "服务端点选择失败。"
                                  );
                                }
                                return;
                              }
                              if (field.key !== "subflowId")
                                return updateConfigField(field.key, value);
                              const selectedSubflow = subflows.find(
                                subflow =>
                                  subflow.id === value && subflow.isEnabled
                              );
                              updateConfigFields({
                                subflowId: value,
                                ...(value !== selectedConfig.subflowId ? {
                                  resolvedSubflowId: undefined,
                                  resolvedSubflowName: undefined,
                                  resolvedSubflowUpdatedAt: undefined,
                                  resolvedSubflowDefinition: undefined,
                                } : {}),
                                zlcxz: selectedSubflow
                                  ? subflowSelectionConfig(
                                      selectedConfig.zlcxz,
                                      selectedSubflow
                                    )
                                  : subflowSelectionConfig(
                                      selectedConfig.zlcxz
                                    ),
                              });
                            }}
                          />
                        );
                      })}
                      {selected.data.kind === "operate" &&
                        activeInspectorGroup.label === "处理人" && (
                          <OperateApprovalEditor
                            config={selectedConfig}
                            workflowId={workflowId}
                            disabled={inspectorDisabled}
                            readOnly={readOnly}
                            onChange={updateConfigFields}
                          />
                        )}
                    </div>
                  </section>
                )}
                {!readOnly && isTemplateNodeType(selected.data.kind) && (
                  <div className="p-4 pt-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full rounded-lg"
                      disabled={inspectorDisabled}
                      onClick={() => {
                        setNameDialog({
                          title: "保存为节点模板",
                          initialName: String(
                            selected.data.label ?? "未命名模板"
                          ),
                          onSave: name =>
                            onSaveTemplate?.({
                              name,
                              nodeType: selected.data
                                .kind as ReuseTemplate["nodeType"],
                              config: structuredClone(selectedConfig),
                            }),
                        });
                      }}
                    >
                      <Save size={13} />
                      保存为节点模板
                    </Button>
                  </div>
                )}
              </div>
            ) : selectedEdgeId ? (
              <div className="m-4 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6 text-foreground">
                <p className="font-semibold">已选中连线</p>
                <p className="aiflow-type-body mt-1">
                  可点击顶部“删除连线”，或按 Delete /
                  Backspace。删除后可立即撤销。
                </p>
                {flowType !== "data" && <div className="aiflow-type-body mt-4 space-y-3 border-t border-border pt-3" data-loop-policy-editor="">
                  <label className="flex min-h-11 items-center gap-2 font-medium">
                    <input type="checkbox" aria-label="启用循环返回上限" disabled={inspectorDisabled}
                      checked={Boolean(edges.find(edge => edge.id === selectedEdgeId)?.data?.loop)}
                      onChange={event => updateSelectedEdgeLoop(event.target.checked ? 3 : null)} />
                    启用循环返回上限
                  </label>
                  {Boolean(edges.find(edge => edge.id === selectedEdgeId)?.data?.loop) && <label className="grid gap-1">
                    最多返回次数（1–1000）
                    <Input type="number" inputMode="numeric" min={1} max={1000} step={1} aria-label="最多返回次数" disabled={inspectorDisabled}
                      aria-invalid={loopLimitInvalid}
                      aria-describedby={loopLimitInvalid ? loopLimitErrorId : undefined}
                      value={loopLimitValue}
                      onChange={event => updateSelectedEdgeLoop(event.target.value === "" ? undefined : Number(event.target.value))} />
                    {loopLimitInvalid && <span id={loopLimitErrorId} role="alert" className="text-sm text-destructive">请输入 1–1000 之间的整数；当前输入尚未保存。</span>}
                  </label>}
                  <p>只在经过此连线时累计；等待、审批和恢复不会重置。请通过路由或办理结果配置退出分支。</p>
                  <p>路由条件可引用此连线的已返回次数：<code className="break-all">{`{{runtime.loopIterations.${selectedEdgeId}}}`}</code></p>
                </div>}
              </div>
            ) : (
              <div className="m-4 mt-8 rounded-lg border border-dashed border-border bg-muted p-4 text-sm leading-6 text-muted-foreground">
                <p className="font-medium text-foreground">暂无配置信息</p>
                <p className="mt-1">
                  请选择画布中的元件查看配置信息；若无元件，请添加元件。
                </p>
              </div>
            ))}
          {inspectorMode !== "compact" && !readOnly && (
            <div data-workflow-inspector-footer="" className={`border-t border-border p-4 ${fullscreen ? "shrink-0 lg:max-h-[25vh] lg:overflow-y-auto" : ""}`}>
              <details>
                <summary className="aiflow-type-control cursor-pointer font-semibold text-foreground">
                  管理我的模板与子流程
                </summary>
                <div className="aiflow-type-control mt-3 grid gap-2">
                  {templates.map(template => (
                    <div
                      key={template.id}
                      className="flex items-center gap-1 rounded border border-border bg-muted p-2"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {template.name}
                      </span>
                      <button
                        type="button"
                        className={canvasHelpLinkClass}
                        onClick={() => {
                          setNameDialog({
                            title: "修改模板名称",
                            initialName: template.name,
                            onSave: name =>
                              name === template.name
                                ? undefined
                                : onUpdateTemplate?.(template, { name }),
                          });
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className={canvasHelpLinkClass}
                        disabled={
                          !isFlowNodeAllowed(flowType, template.nodeType)
                        }
                        title={
                          !isFlowNodeAllowed(flowType, template.nodeType)
                            ? "当前流程类型不支持此模板"
                            : undefined
                        }
                        onClick={() =>
                          addReusableNode({
                            type: template.nodeType,
                            label: template.name,
                            config: template.config,
                          })
                        }
                      >
                        在画布中编辑
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => onDeleteTemplate?.(template.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  {subflows.map(subflow => (
                    <div
                      key={subflow.id}
                      className="flex items-center gap-1 rounded border border-aiflow-special-border bg-aiflow-special-surface p-2"
                    >
                      <FolderTree size={12} className="text-aiflow-special" />
                      <span className="min-w-0 flex-1 truncate">
                        {subflow.name}
                      </span>
                      <button
                        type="button"
                        className="text-aiflow-special hover:underline"
                        onClick={() =>
                          onToggleSubflow?.(subflow, !subflow.isEnabled)
                        }
                      >
                        {subflow.isEnabled ? "停用" : "启用"}
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => onDeleteSubflow?.(subflow.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  {!templates.length && !subflows.length && (
                    <p className={canvasBodyHelpClass}>
                      从选中节点保存模板，或在设计器顶部将当前流程保存为子流程。
                    </p>
                  )}
                </div>
              </details>
            </div>
          )}
        </aside>
      )}
      {nameDialog && (
        <CanvasNameDialog {...nameDialog} onClose={() => setNameDialog(null)} />
      )}
    </div>
  );
}
