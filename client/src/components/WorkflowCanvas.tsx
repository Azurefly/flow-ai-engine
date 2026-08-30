import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { trpc } from "@/lib/trpc";
import type { Definition } from "../../../server/workflow-service";
import {
  canConnectFlowNodeTypes,
  createDefaultNodeConfig,
  FLOW_NODE_ALLOWED_TARGETS,
  FLOW_NODE_DEFINITIONS,
  getNodeConfigEvidence,
  readOperateOutcomeMode,
  readOperateOutcomes,
  type FlowNodeDefinition,
  type FlowNodeType,
  type FlowType,
  type NodeConfig,
  validateNodeConfig,
} from "@shared/workflow-node-contract";
import { isFlowNodeAllowed } from "@shared/flow-profile-contract";

type NodeKind = FlowNodeType;
type FlowNodeData = { label: string; kind: NodeKind; config: NodeConfig };
type CanvasNode = Node<FlowNodeData, "workflowNode">;
type ReuseTemplate = {
  id: string;
  name: string;
  nodeType: Exclude<NodeKind, "start" | "end" | "subflow">;
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

function canConnectCanvasNodes(
  source: CanvasNode,
  target: CanvasNode,
  edges: Edge[]
) {
  if (
    source.id === target.id ||
    source.data.kind === "end" ||
    target.data.kind === "start"
  )
    return false;
  if (!canConnectFlowNodeTypes(source.data.kind, target.data.kind))
    return false;
  const outgoing = edges.filter(edge => edge.source === source.id);
  if (
    ["start", "operate", "rest"].includes(source.data.kind) &&
    outgoing.length > 0
  )
    return false;
  if (
    target.data.kind === "end" &&
    edges.some(edge => edge.target === target.id)
  )
    return false;
  if (
    outgoing.some(
      edge =>
        edge.target === target.id &&
        (edge.sourceHandle || "default") === "default"
    )
  )
    return false;
  if (
    target.data.kind === "end" &&
    outgoing.some(edge => edge.target !== target.id)
  )
    return false;
  return true;
}

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

function nodeConfigState(kind: NodeKind, config: NodeConfig): ConfigState {
  try {
    validateNodeConfig(kind, config);
    const defaultConfig = createDefaultNodeConfig(kind);
    return Object.keys(config).some(
      key => JSON.stringify(config[key]) !== JSON.stringify(defaultConfig[key])
    )
      ? "complete"
      : "editing";
  } catch {
    return "partial";
  }
}

function sourceHandles(kind: NodeKind, config: NodeConfig) {
  if (kind === "end") return [];
  if (kind === "condition") return ["true", "false"];
  if (kind === "router") {
    const configured = Array.isArray(config.routes)
      ? config.routes
          .map(route =>
            route && typeof route === "object"
              ? String((route as NodeConfig).handle ?? "")
              : ""
          )
          .filter(Boolean)
      : [];
    return Array.from(
      new Set(
        ["default", String(config.defaultRoute ?? ""), ...configured].filter(
          Boolean
        )
      )
    );
  }
  if (kind === "llm") {
    const failureHandle = String(config.failureHandle ?? "").trim();
    return failureHandle ? ["default", failureHandle] : ["default"];
  }
  if (
    ["http", "rest", "method"].includes(kind) &&
    config.writeSafety === "compensated"
  )
    return ["default", "compensation"];
  if (kind === "operate" && readOperateOutcomeMode(config) === "explicit")
    return readOperateOutcomes(config).map(outcome => outcome.sourceHandle);
  return ["default"];
}

function FlowNodeCard({ data, selected }: NodeProps) {
  const nodeData = data as unknown as FlowNodeData;
  const appearance = nodeAppearance[nodeData.kind];
  const configState = nodeConfigState(nodeData.kind, nodeData.config);
  const handles = sourceHandles(nodeData.kind, nodeData.config);
  const hasTarget = nodeData.kind !== "start";
  const routeItems =
    nodeData.kind === "router" && Array.isArray(nodeData.config.routes)
      ? (nodeData.config.routes.filter(
          item => item && typeof item === "object"
        ) as NodeConfig[])
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
      className={`relative w-56 max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border bg-white px-4 py-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition-all ${selected ? "-translate-y-0.5 ring-4 ring-indigo-100 shadow-[0_12px_30px_rgba(79,70,229,0.16)]" : "hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.12)]"}`}
      style={{ borderColor: `${appearance.color}66` }}
    >
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Left}
          id="target"
          className="!h-2.5 !w-2.5 !border-2 !border-white"
          style={{ backgroundColor: appearance.color }}
        />
      )}
      <div className="flex items-center gap-3">
        <NodeTypeGlyph icon={appearance.icon} color={appearance.color} />
        <div className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold leading-5 text-slate-800">
            {nodeData.label}
          </span>
          <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">
            {nodeData.kind}
          </span>
        </div>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${configState === "partial" ? "bg-red-500" : configState === "editing" ? "bg-blue-500" : "bg-emerald-500"}`}
          title={
            configState === "partial"
              ? "未完全配置"
              : configState === "editing"
                ? "配置中"
                : "已配置"
          }
        />
      </div>
      {nodeData.kind === "llm" && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5 text-[10px] font-semibold">
          <span className="rounded-md bg-indigo-50 px-1.5 py-1 text-indigo-700">
            {String(nodeData.config.model || "自动模型")}
          </span>
          <span className="rounded-md bg-slate-100 px-1.5 py-1 text-slate-600">
            {String(llmGovernance.dataClassification || "internal")}
          </span>
          {nodeData.config.outputSchema ? (
            <span className="rounded-md bg-emerald-50 px-1.5 py-1 text-emerald-700">
              结构化输出
            </span>
          ) : null}
          {llmGovernance.humanReviewRequired === true ? (
            <span className="rounded-md bg-amber-50 px-1.5 py-1 text-amber-700">
              人工复核
            </span>
          ) : null}
          {Number(llmGovernance.maxCostMicros) > 0 ? (
            <span className="rounded-md bg-rose-50 px-1.5 py-1 text-rose-700">
              ≤ {Number(llmGovernance.maxCostMicros)} μ
            </span>
          ) : null}
        </div>
      )}
      {routeItems.length > 0 && (
        <div className="mt-3 grid gap-1.5 border-t border-slate-100 pt-2.5">
          {routeItems.map((route, index) => {
            const routeName = String(
              route.label ||
                route.routerRuleName ||
                route.handle ||
                `规则 ${index + 1}`
            );
            const routeTarget = String(
              route.targetNodeId ||
                route.target ||
                route.routerTargetId ||
                "待连线"
            );
            return (
              <div
                key={String(route.handle || route.routerRuleId || index)}
                className="flex items-center justify-between gap-3 text-[10px]"
              >
                <span
                  className="min-w-0 flex-1 truncate rounded-md bg-violet-50 px-1.5 py-1 font-semibold text-violet-700"
                  title={routeName}
                >
                  {routeName}
                </span>
                <span
                  className="max-w-24 truncate text-slate-400"
                  title={routeTarget}
                >
                  → {routeTarget}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {handles.map((id, index) => (
        <Handle
          key={id}
          type="source"
          position={Position.Right}
          id={id}
          className="!h-2.5 !w-2.5 !border-2 !border-white"
          style={{
            top: `${((index + 1) / (handles.length + 1)) * 100}%`,
            backgroundColor: appearance.color,
          }}
          title={id}
        />
      ))}
    </div>
  );
}

const nodeTypes = { workflowNode: FlowNodeCard };

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
    animated: true,
    interactionWidth: 24,
    style: { stroke: "#94a3b8", strokeWidth: 1.7 },
  }));
}

function toDefinition(
  nodes: Node[],
  edges: Edge[],
  base: Definition
): Definition {
  return {
    ...base,
    nodes: nodes.map(node => ({
      id: node.id,
      type: (node.data as FlowNodeData).kind,
      name: String((node.data as FlowNodeData).label ?? "未命名节点"),
      position: node.position,
      config: (node.data as FlowNodeData).config ?? {},
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      sourceNodeId: edge.source,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetNodeId: edge.target,
    })),
  };
}

/** Keep modern router rules and legacy lysz entries aligned with actual outgoing edges. */
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
    const handles = new Set(
      outgoing.map(edge => edge.sourceHandle || "default")
    );
    const config = node.data.config as NodeConfig;
    const existingRoutes = Array.isArray(config.routes) ? config.routes : [];
    const existingLegacy = Array.isArray(config.lysz) ? config.lysz : [];
    const routes = existingRoutes
      .filter(
        item =>
          item &&
          typeof item === "object" &&
          handles.has(
            String(
              (item as NodeConfig).handle ??
                (item as NodeConfig).code ??
                "default"
            )
          )
      )
      .map(item => {
        const route = item as NodeConfig;
        const handle = String(route.handle ?? route.code ?? "default");
        const target = outgoing.find(
          edge => (edge.sourceHandle || "default") === handle
        )?.target;
        return target
          ? { ...route, handle, target, targetNodeId: target }
          : route;
      });
    for (const edge of outgoing) {
      const handle = edge.sourceHandle || "default";
      if (
        !routes.some(
          route =>
            String(
              (route as NodeConfig).handle ??
                (route as NodeConfig).code ??
                "default"
            ) === handle
        )
      )
        routes.push({
          handle,
          label: handle === "default" ? "默认" : handle,
          target: edge.target,
          targetNodeId: edge.target,
        });
    }
    const lysz = existingLegacy
      .filter(item => item && typeof item === "object")
      .filter(item => {
        const value = item as NodeConfig;
        const route =
          value.route && typeof value.route === "object"
            ? (value.route as NodeConfig)
            : value;
        return handles.has(
          String(route.handle ?? route.routerRuleId ?? route.code ?? "default")
        );
      })
      .map(item => {
        const value = item as NodeConfig;
        const route =
          value.route && typeof value.route === "object"
            ? (value.route as NodeConfig)
            : value;
        const handle = String(
          route.handle ?? route.routerRuleId ?? route.code ?? "default"
        );
        const target = outgoing.find(
          edge => (edge.sourceHandle || "default") === handle
        )?.target;
        return target
          ? {
              ...value,
              routerTargetId: target,
              routerTargetyId: target,
              route: { ...route, routerTargetId: target },
            }
          : value;
      });
    for (const edge of outgoing) {
      const handle = edge.sourceHandle || "default";
      if (
        !lysz.some(item => {
          const value = item as NodeConfig;
          const route =
            value.route && typeof value.route === "object"
              ? (value.route as NodeConfig)
              : value;
          return (
            String(
              route.handle ?? route.routerRuleId ?? route.code ?? "default"
            ) === handle
          );
        })
      )
        lysz.push({
          routerTargetId: edge.target,
          routerTargetyId: edge.target,
          route: {
            routerRuleId: handle,
            routerRuleName: handle,
            routerTargetId: edge.target,
          },
        });
    }
    return {
      ...node,
      data: { ...node.data, config: { ...config, routes, lysz } },
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
  onChange,
}: {
  field: FlowNodeDefinition["fields"][number];
  value: unknown;
  fallback: unknown;
  disabled: boolean;
  runtimeOptions?: Array<{ value: string; label: string }>;
  onChange: (value: unknown) => void;
}) {
  const effectiveValue = value ?? fallback;
  const label = (
    <span className="flex items-center gap-1 text-xs font-semibold text-slate-700">
      {field.required && <i className="not-italic text-red-500">*</i>}
      {field.label}
    </span>
  );
  const inputClass =
    "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400";
  if (runtimeOptions) {
    const current = String(effectiveValue ?? "");
    const currentAvailable = runtimeOptions.some(
      option => option.value === current
    );
    return (
      <label className="grid gap-1.5">
        {label}
        <select
          className={inputClass}
          disabled={disabled}
          value={current}
          onChange={event => onChange(event.target.value)}
        >
          <option value="">请选择已启用的私有子流程</option>
          {current && !currentAvailable && (
            <option value={current}>当前映射不可用 · {current}</option>
          )}
          {runtimeOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldHelp help={field.help} />
      </label>
    );
  }
  if (field.kind === "boolean")
    return (
      <label className="grid gap-1.5">
        {label}
        <span className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700">
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
      <label className="grid gap-1.5">
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
      <label className="grid gap-1.5">
        {label}
        <textarea
          key={String(effectiveValue ?? "")}
          className="min-h-20 w-full rounded-md border border-slate-200 bg-white p-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          defaultValue={String(effectiveValue ?? "")}
          disabled={disabled}
          onBlur={event => onChange(event.target.value)}
        />
        <FieldHelp help={field.help} />
      </label>
    );
  if (field.kind === "json")
    return (
      <StructuredValueEditor
        key={JSON.stringify(effectiveValue)}
        field={field}
        value={effectiveValue}
        disabled={disabled}
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
        key={JSON.stringify(effectiveValue)}
        field={field}
        value={effectiveValue}
        disabled={disabled}
        onChange={onChange}
      />
    );
  if (field.kind === "number")
    return (
      <label className="grid gap-1.5">
        {label}
        <input
          key={String(effectiveValue ?? "")}
          type="number"
          className={inputClass}
          defaultValue={
            effectiveValue === undefined || effectiveValue === null
              ? ""
              : String(effectiveValue)
          }
          disabled={disabled}
          onBlur={event =>
            onChange(
              event.target.value === "" ? "" : Number(event.target.value)
            )
          }
        />
        <FieldHelp help={field.help} />
      </label>
    );
  return (
    <label className="grid gap-1.5">
      {label}
      <input
        key={String(effectiveValue ?? "")}
        className={inputClass}
        defaultValue={String(effectiveValue ?? "")}
        disabled={disabled}
        onBlur={event => onChange(event.target.value)}
      />
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
    "h-8 min-w-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50";
  if (Array.isArray(value)) {
    return (
      <div className="grid min-w-0 gap-2 rounded border border-slate-200 bg-white p-2">
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
              className="rounded px-1 text-slate-400 hover:text-red-600"
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
            className="h-7 text-[11px]"
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
            className="h-7 text-[11px]"
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
            className="h-7 text-[11px]"
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
      <div className="grid min-w-0 gap-2 rounded border border-slate-200 bg-white p-2">
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
              className="rounded px-1 text-slate-400 hover:text-red-600"
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
            className="h-7 text-[11px]"
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
            className="h-7 text-[11px]"
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
            className="h-7 text-[11px]"
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
    { key: "hqfw", label: "获取范围" },
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
    "h-8 min-w-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50";
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
      <label className="inline-flex items-center gap-2 text-xs text-slate-700">
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
      <div className="grid gap-1 rounded border border-slate-200 bg-white p-2">
        {(spec.options ?? []).map(option => (
          <label
            key={option.value}
            className="inline-flex items-center gap-2 text-xs font-normal text-slate-700"
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
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as NodeConfig)
      : {};
  const knownKeys = new Set(specs.map(spec => spec.key));
  const extras = Object.fromEntries(
    Object.entries(record).filter(([key]) => !knownKeys.has(key))
  );
  return (
    <div className="grid gap-2">
      {specs.map(spec => (
        <label
          key={spec.key}
          className="grid min-w-0 gap-1 text-[11px] font-medium text-slate-600"
        >
          <span>{spec.label}</span>
          <OriginalFieldControl
            spec={spec}
            value={record[spec.key]}
            disabled={disabled}
            onChange={next => onChange({ ...record, [spec.key]: next })}
          />
          {spec.help && (
            <span className="font-normal leading-4 text-slate-400">
              {spec.help}
            </span>
          )}
        </label>
      ))}
      {Object.keys(extras).length > 0 && (
        <div className="grid gap-1">
          <span className="text-[11px] font-medium text-slate-600">
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

function StructuredValueEditor({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FlowNodeDefinition["fields"][number];
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const isList = Array.isArray(value);
  const list = isList ? value : [];
  const isSpecializedList =
    isList &&
    (["routes", "fields", "restHeaderParam", "restGetBodyParam"].includes(
      field.key
    ) ||
      Boolean(ORIGINAL_LIST_ITEM_SPECS[field.key]));
  const updateList = (next: unknown[]) => onChange(next);
  const newListItem =
    field.key === "routes"
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
                    hqfw: "",
                    fsfsz: [],
                    jsfsz: [],
                    code: "",
                  }
                : field.key === "zlcck"
                  ? { connect: { id: "", text: "", yId: "" }, end: "" }
                  : "";
  const originalObject = ORIGINAL_OBJECT_FIELD_SPECS[field.key];
  return (
    <fieldset className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <legend className="px-1 text-xs font-semibold text-slate-700">
        {field.required && <i className="mr-1 not-italic text-red-500">*</i>}
        {field.label}
      </legend>
      {isSpecializedList ? (
        <div className="grid gap-2">
          {list.map((item, index) => (
            <StructuredListRow
              key={field.key + "-" + index}
              fieldKey={field.key}
              item={item}
              disabled={disabled}
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
  onChange,
  onRemove,
}: {
  fieldKey: string;
  item: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
  onRemove: () => void;
}) {
  const inputClass =
    "h-8 min-w-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50";
  const originalSpecs = ORIGINAL_LIST_ITEM_SPECS[fieldKey];
  if (originalSpecs) {
    const record =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as NodeConfig)
        : {};
    const knownKeys = new Set(originalSpecs.map(spec => spec.key));
    const extras = Object.fromEntries(
      Object.entries(record).filter(([key]) => !knownKeys.has(key))
    );
    return (
      <div className="grid gap-2 rounded border border-slate-200 bg-white p-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-600">
            原版
            {fieldKey === "lysz"
              ? "路由"
              : fieldKey === "qxkz"
                ? "权限"
                : fieldKey === "bddx"
                  ? "绑定对象"
                  : "子流程出口"}
            配置
          </span>
          <button
            type="button"
            className="text-slate-400 hover:text-red-600"
            disabled={disabled}
            onClick={onRemove}
            aria-label="删除原版配置项"
          >
            <Trash2 size={14} />
          </button>
        </div>
        {originalSpecs.map(spec => (
          <label
            key={spec.key}
            className="grid min-w-0 gap-1 text-[11px] font-medium text-slate-600"
          >
            <span>{spec.label}</span>
            <OriginalFieldControl
              spec={spec}
              value={record[spec.key]}
              disabled={disabled}
              onChange={next => onChange({ ...record, [spec.key]: next })}
            />
          </label>
        ))}
        {Object.keys(extras).length > 0 && (
          <div className="grid gap-1">
            <span className="text-[11px] font-medium text-slate-600">
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
    const condition =
      route.condition && typeof route.condition === "object"
        ? (route.condition as NodeConfig)
        : {};
    const roleKeys = Array.isArray(route.roleKeys)
      ? route.roleKeys.map(String)
      : [];
    return (
      <div className="grid min-w-0 gap-3 rounded-lg border border-violet-100 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-violet-700">
            {String(route.label ?? "新路径")}
          </span>
          <button
            type="button"
            className="grid min-h-11 min-w-11 place-items-center text-slate-400 hover:text-red-600"
            disabled={disabled}
            onClick={onRemove}
            aria-label="删除路由规则"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-[11px] text-slate-500">
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
          <label className="grid min-w-0 gap-1 text-[11px] text-slate-500">
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
        <label className="grid min-w-0 gap-1 text-[11px] text-slate-500">
          目标节点
          <span className="flex min-h-11 items-center rounded border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700">
            {String(
              route.targetNodeId ??
                route.target ??
                "请从此路径句柄连线到目标状态节点"
            )}
          </span>
        </label>
        <label className="grid min-w-0 gap-1 text-[11px] text-slate-500">
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
        <details className="rounded border border-slate-100 bg-slate-50">
          <summary className="cursor-pointer px-2 py-3 text-[11px] font-medium text-slate-600">
            附加数据条件
          </summary>
          <div className="grid min-w-0 gap-2 border-t border-slate-100 p-2 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)]">
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
      <div className="grid grid-cols-[1fr_1fr_100px_auto_auto] items-center gap-2 rounded border border-slate-200 bg-white p-2">
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
        <label className="flex items-center gap-1 text-[11px] text-slate-600">
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
          className="text-slate-400 hover:text-red-600"
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
          className="text-slate-400 hover:text-red-600"
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
        className="text-slate-400 hover:text-red-600"
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
  return <p className="text-[11px] leading-4 text-slate-500">{help}</p>;
}

type ConfigField = FlowNodeDefinition["fields"][number];
type ConfigGroup = { label: string; description: string; keys: string[] };

const CONFIG_GROUPS: Partial<Record<NodeKind, ConfigGroup[]>> = {
  state: [
    {
      label: "基础状态",
      description: "状态代号用于审计与流转；状态名称是当前办理人的人员级状态。",
      keys: ["nodeDh", "jdmc", "stateType", "stateColor"],
    },
    {
      label: "人员与操作",
      description:
        "保留原版绑定角色、状态固有操作和业务操作，决定不同人员在该状态可执行什么。",
      keys: ["bdjs", "jdgycz", "ywcz"],
    },
    {
      label: "流程参与方显示",
      description:
        "流程状态是发起人等参与方看到的文案，可与当前办理人的状态名称不同。",
      keys: ["flowStatus", "bdym"],
    },
  ],
  operate: [
    {
      label: "基础信息",
      description:
        "标识这个操作节点。操作代号用于流程识别，操作名称展示给办理人。",
      keys: ["nodeDh", "czmc", "lsWorkZone"],
    },
    {
      label: "权限控制",
      description:
        "决定哪些角色可以看见或办理该操作，以及绑定数据是否影响接收人。",
      keys: ["bddxcrjsrsx", "bdczcrjsrsx", "qxkz"],
    },
    {
      label: "绑定对象",
      description: "指定操作需要关联的业务对象、获取范围和双方数据。",
      keys: ["bddx"],
    },
    {
      label: "绑定操作",
      description: "配置办理动作、或签/会签方式、角色和通过比例。",
      keys: ["bdcz"],
    },
    {
      label: "属性设置",
      description: "配置自动关联、部门操作权限和必须完成的子流程。",
      keys: ["sxsz"],
    },
    {
      label: "发送方设置",
      description: "配置流程发送方的身份、固有操作和临时角色。",
      keys: ["fsfsz"],
    },
    {
      label: "接收方设置",
      description: "配置流程接收方的固有操作和临时角色。",
      keys: ["jsfsz"],
    },
    {
      label: "自动执行",
      description:
        "决定该操作是否自动执行及其触发条件。旧版代码仅保存，不会直接运行。",
      keys: ["zdzx"],
    },
    {
      label: "当前运行设置",
      description:
        "将原版接收方、权限角色或组织关系解析为人员级待办；不会覆盖上面的原版兼容配置。",
      keys: [
        "assigneeMode",
        "assigneeRoleCode",
        "instruction",
        "assigneeUserId",
      ],
    },
  ],
  router: [
    {
      label: "基础信息",
      description: "标识路由节点，并决定是否允许多个分支同时流转。",
      keys: ["nodeDh", "lymc", "gbms"],
    },
    {
      label: "原版路由设置",
      description:
        "保留原页面的目标节点、优先权重、条件和代码结构，用于兼容已有流程。",
      keys: ["lysz"],
    },
    {
      label: "当前安全路由规则",
      description: "运行时按顺序匹配这些规则；默认分支用于所有规则都未命中时。",
      keys: ["routes", "defaultRoute"],
    },
  ],
  subflow: [
    {
      label: "基础信息",
      description: "选择要调用的原版子流程，并设置当前节点代号。",
      keys: ["zlcxz", "nodeDh"],
    },
    {
      label: "流转方式",
      description:
        "决定主流程是否等待、由发送方还是接收方发起，以及附加进入条件。",
      keys: ["sfgqzlc", "zlcfqf", "gdtj"],
    },
    {
      label: "入口映射",
      description: "把当前流程数据映射到子流程的开始节点和入口操作。",
      keys: ["zlcrk"],
    },
    {
      label: "出口映射",
      description: "定义子流程结束后回到当前流程的连接节点。",
      keys: ["zlcck"],
    },
    {
      label: "当前运行映射",
      description:
        "将原版流程选择映射到当前已启用的私有子流程，并设置传入数据。",
      keys: ["subflowId", "input"],
    },
  ],
};

function configFieldGroups(kind: NodeKind, fields: ConfigField[]) {
  const definitions = CONFIG_GROUPS[kind];
  if (!definitions)
    return [
      {
        label: "节点配置",
        description: "按照字段说明填写该节点运行所需的信息。",
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
          description: "保留已有流程中的扩展配置，不会在保存时丢失。",
          keys: [],
          fields: remaining,
        },
      ]
    : groups;
}

export default function WorkflowCanvas({
  workflowId,
  flowType = "state",
  definition,
  readOnly = false,
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
  flowType?: FlowType;
  definition?: Definition | null;
  readOnly?: boolean;
  onDefinitionChange?: (definition: Definition) => void;
  templates?: ReuseTemplate[];
  subflows?: ReuseSubflow[];
  onSaveTemplate?: (template: Omit<ReuseTemplate, "id">) => void;
  onUpdateTemplate?: (
    template: ReuseTemplate,
    updates: { name?: string; config?: NodeConfig }
  ) => void;
  onDeleteTemplate?: (id: string) => void;
  onToggleSubflow?: (subflow: ReuseSubflow, isEnabled: boolean) => void;
  onDeleteSubflow?: (id: string) => void;
  showCanvasActions?: boolean;
}) {
  const initial = definition ?? defaultDefinition();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(
    toFlowNodes(initial)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [deletedEdge, setDeletedEdge] = useState<Edge | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu>(null);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("normal");
  const [inspectorLocked, setInspectorLocked] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("");
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance<
    CanvasNode,
    Edge
  > | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const participantPreview = trpc.workflow.previewParticipants.useMutation();
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<Definition>(initial);
  const appliedDefinitionRef = useRef("");
  const emittedDefinitionRef = useRef("");
  const appliedWorkflowRef = useRef<string | undefined>(undefined);
  const definitionSignature = useMemo(
    () => JSON.stringify(definition ?? defaultDefinition()),
    [definition]
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
    if (!onDefinitionChange) return;
    const next = toDefinition(nodes, edges, baseRef.current);
    emittedDefinitionRef.current = JSON.stringify(next);
    onDefinitionChange(next);
  }, [edges, nodes, onDefinitionChange]);

  useEffect(() => {
    const syncFullscreen = () =>
      setFullscreen(document.fullscreenElement === canvasRegionRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const inspect = (event?: Event) => {
      const requestedNodeId = (
        event as CustomEvent<{ nodeId?: string }> | undefined
      )?.detail?.nodeId;
      const next =
        (requestedNodeId && nodes.find(node => node.id === requestedNodeId)) ||
        nodes.find(node => !["start", "end"].includes(node.data.kind)) ||
        nodes[0];
      if (!next) return;
      setSelectedId(next.id);
      setInspectorMode("normal");
      canvasRegionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      reactFlow?.fitView({ nodes: [next], padding: 0.6, duration: 180 });
    };
    window.addEventListener("flow:inspect-node", inspect);
    return () => window.removeEventListener("flow:inspect-node", inspect);
  }, [nodes, reactFlow]);

  useEffect(() => {
    const focus = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (!nodeId) return;
      const node = nodes.find(item => item.id === nodeId);
      if (!node) return;
      setSelectedId(node.id);
      setInspectorMode("normal");
      canvasRegionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      reactFlow?.fitView({ nodes: [node], padding: 0.6, duration: 180 });
    };
    window.addEventListener("flow:focus-node", focus);
    return () => window.removeEventListener("flow:focus-node", focus);
  }, [nodes, reactFlow]);

  const selected = useMemo(
    () => nodes.find(node => node.id === selectedId),
    [nodes, selectedId]
  );
  const selectedDefinition = selected
    ? (() => {
        const item = FLOW_NODE_DEFINITIONS[selected.data.kind];
        return getNodeConfigEvidence(selected.data.kind) ===
          "compatibility-extension"
          ? {
              ...item,
              description: `${item.description} 当前裁剪安装包未保留节点打包脚本；以下字段按安全兼容契约呈现，并会保留未知扩展字段。`,
            }
          : item;
      })()
    : null;
  const selectedConfig = (selected?.data.config ?? {}) as NodeConfig;
  useEffect(() => {
    participantPreview.reset();
  }, [selectedId]);
  const selectedDefaults = selected
    ? createDefaultNodeConfig(selected.data.kind)
    : {};
  const selectedConfigState = selected
    ? nodeConfigState(selected.data.kind, selectedConfig)
    : null;
  const selectedFieldGroups =
    selected && selectedDefinition
      ? configFieldGroups(selected.data.kind, selectedDefinition.fields)
      : [];
  const activeInspectorGroup =
    selectedFieldGroups.find(group => group.label === inspectorTab) ??
    selectedFieldGroups[0];
  const inspectorDisabled = readOnly || inspectorLocked;
  const displayedEdges = useMemo(
    () =>
      edges.map(edge => {
        const source = nodes.find(node => node.id === edge.source);
        const routes =
          source?.data.kind === "router" &&
          Array.isArray(source.data.config.routes)
            ? (source.data.config.routes as NodeConfig[])
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
        return edge.id === selectedEdgeId
          ? {
              ...edge,
              label,
              selected: true,
              interactionWidth: 24,
              labelStyle: { fill: "#5b21b6", fontSize: 11, fontWeight: 600 },
              labelBgStyle: { fill: "#f5f3ff", fillOpacity: 0.96 },
              labelBgPadding: [5, 3] as [number, number],
              labelBgBorderRadius: 6,
              style: { ...edge.style, stroke: "#4f46e5", strokeWidth: 3 },
            }
          : {
              ...edge,
              label,
              selected: false,
              interactionWidth: 24,
              labelStyle: { fill: "#6d28d9", fontSize: 11, fontWeight: 600 },
              labelBgStyle: { fill: "#ffffff", fillOpacity: 0.94 },
              labelBgPadding: [5, 3] as [number, number],
              labelBgBorderRadius: 6,
            };
      }),
    [edges, nodes, selectedEdgeId]
  );

  useEffect(() => {
    setInspectorTab(selectedFieldGroups[0]?.label ?? "");
  }, [selectedId]);

  const addNode = (item: (typeof palette)[number]) => {
    if (readOnly) return;
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
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const removeNode = useCallback(
    (nodeId: string) => {
      if (readOnly || nodeId === "start" || nodeId === "end") return;
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
    [edges, readOnly, setEdges, setNodes]
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
  }, [edges, nodes, readOnly, setEdges, setNodes]);

  const alignSelectedNodes = useCallback(
    (axis: "X" | "Y", anchorId: string) => {
      if (readOnly) return;
      const selectedNodes = nodes.filter(node => node.selected);
      if (selectedNodes.length < 2) return;
      const anchor = nodes.find(node => node.id === anchorId);
      if (!anchor) return;
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
    [nodes, readOnly, setNodes]
  );

  const addContextNode = useCallback(
    (item: (typeof palette)[number], sourceId: string) => {
      if (readOnly) return;
      const source = nodes.find(node => node.id === sourceId);
      if (!source) return;
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
      if (!canConnectCanvasNodes(source, nextNode, edges)) {
        setContextMenu(null);
        return;
      }
      const sourceHandle =
        source.data.kind === "condition"
          ? "true"
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
        animated: true,
        interactionWidth: 24,
        style: { stroke: "#94a3b8", strokeWidth: 1.7 },
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
    [edges, nodes, readOnly, setEdges, setNodes]
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !connection.source || !connection.target) return;
      const source = nodes.find(node => node.id === connection.source);
      const target = nodes.find(node => node.id === connection.target);
      if (!source || !target || !canConnectCanvasNodes(source, target, edges))
        return;
      const nextEdge = {
        ...connection,
        id: "edge-" + Date.now(),
        targetHandle: "target",
        animated: true,
        interactionWidth: 24,
        style: { stroke: "#94a3b8", strokeWidth: 1.7 },
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
    [edges, nodes, readOnly, setEdges, setNodes]
  );

  const deleteSelectedEdge = useCallback(() => {
    if (readOnly || !selectedEdgeId) return;
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
  }, [nodes, readOnly, selectedEdgeId, setEdges, setNodes]);

  const undoDeletedEdge = useCallback(() => {
    if (readOnly || !deletedEdge) return;
    if (
      !nodes.some(node => node.id === deletedEdge.source) ||
      !nodes.some(node => node.id === deletedEdge.target)
    ) {
      setDeletedEdge(null);
      return;
    }
    const nextEdges = edges.some(edge => edge.id === deletedEdge.id)
      ? edges
      : edges.concat(deletedEdge);
    setEdges(nextEdges);
    setNodes(current => syncRouterRouteTargets(current, nextEdges));
    setSelectedEdgeId(deletedEdge.id);
    setSelectedId(null);
    setDeletedEdge(null);
  }, [deletedEdge, edges, nodes, readOnly, setEdges, setNodes]);

  useEffect(() => {
    if (readOnly) return;
    const handleDeleteKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      )
        return;
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
    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [
    deleteSelectedEdge,
    deleteSelectedNodes,
    nodes,
    readOnly,
    selectedEdgeId,
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
    },
    [setNodes]
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
      setNodes(current => current.concat(dropped));
      setSelectedId(dropped.id);
      setContextMenu(null);
    },
    [reactFlow, readOnly, setNodes]
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
  const updateConfigField = (key: string, value: unknown) =>
    updateConfigFields({ [key]: value });

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
    const width = Math.max(900, ...nodes.map(node => node.position.x + 240));
    const height = Math.max(520, ...nodes.map(node => node.position.y + 140));
    const byId = new Map(nodes.map(node => [node.id, node]));
    const lines = edges
      .map(edge => {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        return source && target
          ? `<line x1="${source.position.x + 164}" y1="${source.position.y + 43}" x2="${target.position.x}" y2="${target.position.y + 43}" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrow)" />`
          : "";
      })
      .join("");
    const cards = nodes
      .map(
        node =>
          `<g><rect x="${node.position.x}" y="${node.position.y}" width="164" height="72" rx="10" fill="#ffffff" stroke="${colorFor(node.data.kind)}" stroke-width="2"/><text x="${node.position.x + 14}" y="${node.position.y + 30}" fill="#0f172a" font-size="14" font-family="Arial, sans-serif" font-weight="700">${escapeXml(node.data.label)}</text><text x="${node.position.x + 14}" y="${node.position.y + 52}" fill="#64748b" font-size="10" font-family="Arial, sans-serif">${escapeXml(node.data.kind.toUpperCase())}</text></g>`
      )
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker></defs><rect width="100%" height="100%" fill="#f8fafc"/>${lines}${cards}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "flow-canvas.svg";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = async () => {
    if (!canvasRegionRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await canvasRegionRef.current.requestFullscreen();
  };

  useEffect(() => {
    const focusCanvas = () =>
      canvasRegionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    const clearHighlight = () => {
      setSelectedId(null);
      setSelectedEdgeId(null);
      setNodes(current => current.map(node => ({ ...node, selected: false })));
      focusCanvas();
    };
    const neatenCanvas = () => {
      reactFlow?.fitView({ padding: 0.24, duration: 180 });
      focusCanvas();
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
      window.removeEventListener("flow:clear-highlight", clearHighlight);
      window.removeEventListener("flow:neaten-canvas", neatenCanvas);
      window.removeEventListener("flow:save-canvas-image", saveCanvasImage);
      window.removeEventListener("flow:fullscreen-canvas", fullscreenCanvas);
    };
  }, [reactFlow, fullscreen]);

  return (
    <div
      data-aiflow-workflow-canvas=""
      className={
        inspectorMode === "maximized"
          ? "grid min-h-[650px] min-w-0 max-w-full grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(0,1fr)_620px]"
          : inspectorMode === "compact"
            ? "grid min-h-[650px] min-w-0 max-w-full grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(0,1fr)_72px]"
            : "grid min-h-[650px] min-w-0 max-w-full grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(0,1fr)_420px]"
      }
    >
      <section ref={canvasRegionRef} className="relative min-w-0 bg-slate-50">
        <div
          data-flow-canvas-toolbar=""
          className="border-b border-slate-200 bg-white"
        >
          <div
            data-flow-node-palette=""
            className="flex min-h-14 items-center gap-1 overflow-x-auto px-3 py-1.5"
          >
            {palette
              .filter(item => isFlowNodeAllowed(flowType, item.type))
              .map(item => (
                <Button
                  key={item.type}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 shrink-0 gap-2 rounded-xl px-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  disabled={readOnly}
                  draggable={!readOnly}
                  onDragStart={event => handlePaletteDragStart(event, item)}
                  onClick={() => addNode(item)}
                  title={item.description}
                >
                  <NodeTypeGlyph
                    icon={item.icon}
                    color={item.color}
                    size="palette"
                  />
                  {item.label}
                </Button>
              ))}
            {(flowType === "state" || flowType === "control") && (
              <>
                <span className="mx-1 h-5 w-px bg-slate-200" />
                <span
                  aria-disabled="true"
                  title="原始安装包中为禁用状态，项目资源接入后才可用"
                  className="flex cursor-not-allowed items-center gap-1 rounded px-2 py-1.5 text-xs text-slate-300"
                >
                  <Database size={14} />
                  业务资源
                </span>
                <span
                  aria-disabled="true"
                  title="原始安装包中为禁用状态，物理资源接入后才可用"
                  className="flex cursor-not-allowed items-center gap-1 rounded px-2 py-1.5 text-xs text-slate-300"
                >
                  <Table2 size={14} />
                  物理资源
                </span>
              </>
            )}
          </div>
          {showCanvasActions && (
            <div
              data-flow-canvas-actions=""
              className="flex min-h-10 items-center justify-start gap-1 overflow-x-auto border-t border-slate-100 bg-slate-50/80 px-3 py-1 sm:justify-end"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-xs text-slate-600"
                onClick={() =>
                  window.dispatchEvent(new Event("flow:neaten-canvas"))
                }
                title="整理画布"
              >
                <Waypoints size={14} />
                整理画布
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-xs text-slate-600"
                onClick={() =>
                  window.dispatchEvent(new Event("flow:save-canvas-image"))
                }
                title="保存为图片"
              >
                <Download size={14} />
                保存为图片
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-xs text-slate-600"
                onClick={() =>
                  window.dispatchEvent(new Event("flow:fullscreen-canvas"))
                }
                title="全屏展示"
              >
                <Maximize2 size={14} />
                {fullscreen ? "退出全屏" : "全屏展示"}
              </Button>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-red-600 disabled:text-slate-300"
                  disabled={!selectedEdgeId}
                  onClick={deleteSelectedEdge}
                  title={
                    selectedEdgeId
                      ? "删除选中的连线（Delete 或 Backspace）"
                      : "先单击画布中的连线"
                  }
                >
                  <Trash2 size={14} />
                  删除连线
                </Button>
              )}
              {!readOnly && deletedEdge && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-indigo-600"
                  onClick={undoDeletedEdge}
                  title="恢复刚删除的连线"
                >
                  <RotateCcw size={14} />
                  撤销删线
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-xs text-slate-600"
                onClick={() =>
                  window.dispatchEvent(new Event("flow:clear-highlight"))
                }
                title="取消高亮"
              >
                <MousePointer2 size={14} />
                取消高亮
              </Button>
            </div>
          )}
        </div>
        {!readOnly && (templates.length > 0 || subflows.length > 0) && (
          <div className="flex min-h-11 items-center gap-2 overflow-x-auto border-b border-slate-100 bg-slate-50 px-3 py-1.5">
            <span className="shrink-0 text-[10px] font-bold tracking-[.14em] text-slate-400">
              REUSE LIBRARY
            </span>
            {templates.map(template => (
              <Button
                key={template.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1 text-xs"
                onClick={() =>
                  addReusableNode({
                    type: template.nodeType,
                    label: template.name,
                    config: template.config,
                  })
                }
              >
                <Save size={12} />
                {template.name}
              </Button>
            ))}
            {subflows
              .filter(subflow => subflow.isEnabled)
              .map(subflow => (
                <Button
                  key={subflow.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1 border-violet-200 text-xs text-violet-700 hover:bg-violet-50"
                  onClick={() =>
                    addReusableNode({
                      type: "subflow",
                      label: subflow.name,
                      config: { subflowId: subflow.id, input: "{{input}}" },
                    })
                  }
                >
                  <FolderTree size={12} />
                  {subflow.name}
                </Button>
              ))}
          </div>
        )}
        <div
          className="relative h-[420px] sm:h-[590px]"
          onDragOver={event => event.preventDefault()}
          onDrop={handleCanvasDrop}
        >
          <details className="absolute left-3 top-3 z-10 rounded-lg border border-slate-200 bg-white/95 text-[11px] text-slate-600 shadow-sm">
            <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-700">
              画布说明
            </summary>
            <div className="grid gap-2 border-t border-slate-100 px-3 py-2">
              <div className="flex flex-wrap gap-3">
                <span className="flex items-center gap-1">
                  <i className="h-2 w-2 rounded-full bg-red-500" />
                  未完全配置
                </span>
                <span className="flex items-center gap-1">
                  <i className="h-2 w-2 rounded-full bg-blue-500" />
                  配置中
                </span>
                <span className="flex items-center gap-1">
                  <i className="h-2 w-2 rounded-full bg-emerald-500" />
                  已配置
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-slate-500">
                <span className="flex items-center gap-1">
                  <Move size={13} />
                  画布移动
                </span>
                <span className="flex items-center gap-1">
                  <Maximize2 size={13} />
                  画布缩放
                </span>
                <span className="flex items-center gap-1">
                  <MousePointer2 size={13} />
                  选择连线
                </span>
                <span className="flex items-center gap-1">
                  <Square size={12} />
                  节点框选
                </span>
              </div>
            </div>
          </details>
          {contextMenu && (
            <div
              data-flow-context-menu=""
              className="absolute z-50 min-w-44 rounded-md border border-slate-200 bg-white py-1 text-xs shadow-xl"
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
                          className="block w-full px-3 py-2 text-left hover:bg-slate-100"
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
                            className="block w-full px-3 py-2 text-left hover:bg-slate-100"
                            onClick={() => {
                              const name = window.prompt(
                                "修改节点名称",
                                String(targetNode.data.label)
                              );
                              if (name?.trim())
                                setNodes(current =>
                                  current.map(item =>
                                    item.id === targetNode.id
                                      ? {
                                          ...item,
                                          data: {
                                            ...item.data,
                                            label: name.trim(),
                                          },
                                        }
                                      : item
                                  )
                                );
                              closeContextMenu();
                            }}
                          >
                            修改名称
                          </button>
                        )}
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left hover:bg-slate-100"
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
                        className="block w-full px-3 py-2 text-left hover:bg-slate-100"
                        onClick={() => showNodePath(targetNode.id)}
                      >
                        查看路径
                      </button>
                      <div className="my-1 border-t border-slate-100" />
                      {!readOnly && targetNode.data.kind !== "end" && (
                        <div className="px-3 py-1 text-[10px] font-semibold text-slate-400">
                          在此节点后添加
                        </div>
                      )}
                      {!readOnly &&
                        targetNode.data.kind !== "end" &&
                        addable.slice(0, 8).map(item => (
                          <button
                            key={item.type}
                            type="button"
                            className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                            onClick={() => addContextNode(item, targetNode.id)}
                          >
                            添加{item.label}
                          </button>
                        ))}
                      {canDelete && (
                        <>
                          <div className="my-1 border-t border-slate-100" />
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
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
                    className="block w-full px-3 py-2 text-left hover:bg-slate-100"
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
                    className="block w-full px-3 py-2 text-left hover:bg-slate-100"
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
                      className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
                      onClick={deleteSelectedNodes}
                    >
                      批量删除
                    </button>
                  )}
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-slate-100"
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
                    className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
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
                  className="block w-full px-3 py-2 text-left hover:bg-slate-100"
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
            nodes={nodes}
            edges={displayedEdges}
            nodeTypes={nodeTypes}
            onInit={setReactFlow}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeSelectionClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeClick={(event, edge) => {
              event.stopPropagation();
              setSelectedEdgeId(edge.id);
              setSelectedId(null);
              setContextMenu(null);
            }}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneClick={() => {
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
            elementsSelectable
            selectionOnDrag={!readOnly}
            selectionKeyCode="Control"
            multiSelectionKeyCode={["Shift", "Control"]}
            fitView
          >
            <Background color="#d9e2ec" gap={20} size={1} />
            <MiniMap
              nodeColor={node => colorFor((node.data as FlowNodeData).kind)}
              pannable
              zoomable
            />
            <Controls showInteractive={!readOnly} />
          </ReactFlow>
        </div>
      </section>
      <aside
        data-workflow-inspector
        className="border-t border-slate-200 bg-white lg:border-l lg:border-t-0"
      >
        <div className="flex min-h-16 items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className={inspectorMode === "compact" ? "hidden" : ""}>
            <p className="text-[10px] font-bold tracking-[.2em] text-indigo-600">
              CONFIGURATION
            </p>
            <h2 className="mt-1 text-sm font-semibold text-slate-900">
              配置信息
            </h2>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className={`rounded p-1.5 text-slate-500 hover:bg-slate-100 ${inspectorLocked ? "text-indigo-600" : ""}`}
              title={inspectorLocked ? "解除面板锁定" : "锁定配置面板"}
              aria-label={inspectorLocked ? "解除面板锁定" : "锁定配置面板"}
              onClick={() => setInspectorLocked(value => !value)}
            >
              <LockKeyhole size={15} />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
              title="最大化面板"
              aria-label="最大化面板"
              onClick={() => setInspectorMode("maximized")}
            >
              <Maximize2 size={15} />
            </button>
            <button
              type="button"
              className={`rounded p-1.5 text-slate-500 hover:bg-slate-100 ${inspectorMode === "normal" ? "text-slate-300" : ""}`}
              title="恢复配置面板"
              aria-label="恢复配置面板"
              onClick={() => setInspectorMode("normal")}
            >
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
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
            <div className="max-h-[650px] overflow-y-auto">
              <div className="space-y-3 p-4">
                <label className="grid gap-1.5 text-xs font-medium text-slate-600">
                  节点名称
                  <input
                    className="h-9 rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
                    value={String(selected.data.label ?? "")}
                    disabled={inspectorDisabled}
                    onChange={event =>
                      updateSelected({ label: event.target.value })
                    }
                  />
                </label>
                <div
                  className={`rounded-lg border px-3 py-2 ${selectedConfigState === "partial" ? "border-red-200 bg-red-50" : selectedConfigState === "editing" ? "border-blue-200 bg-blue-50" : "border-emerald-200 bg-emerald-50"}`}
                >
                  <p className="text-xs font-semibold text-slate-700">
                    {selectedDefinition.label} ·{" "}
                    {selectedConfigState === "partial"
                      ? "未完全配置"
                      : selectedConfigState === "editing"
                        ? "配置中"
                        : "已配置"}
                  </p>
                </div>
                {selected.data.kind === "operate" &&
                  readOperateOutcomeMode(selectedConfig) ===
                    "legacy_cancel" && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      该历史操作仍使用“拒绝即取消实例”的兼容语义。请将结果路由模式改为显式出口，并分别连接同意、拒绝分支。
                    </div>
                  )}
                {selected.data.kind === "operate" && workflowId && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-xs leading-5 text-blue-900">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">参与人解析预览</p>
                        <p className="text-blue-700">
                          以当前登录用户模拟发起人与当前操作人；运行时会再次解析并固化快照。
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
                    {participantPreview.data && (
                      <div className="mt-2 rounded border border-blue-100 bg-white/80 px-2 py-1.5">
                        <p>
                          方式：{participantPreview.data.mode}；候选用户 ID：
                          {participantPreview.data.candidateUserIds.join(", ")}
                        </p>
                        {participantPreview.data.fallbackApplied && (
                          <p className="text-amber-700">
                            已使用兜底：
                            {participantPreview.data.fallbackApplied}
                          </p>
                        )}
                      </div>
                    )}
                    {participantPreview.error && (
                      <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">
                        {participantPreview.error.message}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div
                role="tablist"
                aria-label={`${selectedDefinition.label}配置分类`}
                className="flex gap-1 overflow-x-auto border-y border-slate-100 bg-slate-50 px-3 py-2"
              >
                {selectedFieldGroups.map(group => (
                  <button
                    key={group.label}
                    type="button"
                    role="tab"
                    aria-selected={activeInspectorGroup?.label === group.label}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${activeInspectorGroup?.label === group.label ? "bg-[#3370ed] text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                    onClick={() => setInspectorTab(group.label)}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
              {activeInspectorGroup && (
                <section
                  role="tabpanel"
                  className="m-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-800">
                      {activeInspectorGroup.label}
                    </h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                      {activeInspectorGroup.description}
                    </p>
                  </div>
                  <div className="space-y-4">
                    {activeInspectorGroup.fields.map(field => {
                      const fieldValue = configFieldValue(
                        field,
                        selectedConfig
                      );
                      const runtimeOptions =
                        field.key === "subflowId"
                          ? subflows
                              .filter(subflow => subflow.isEnabled)
                              .map(subflow => ({
                                value: subflow.id,
                                label: subflow.name,
                              }))
                          : undefined;
                      return (
                        <ConfigFieldEditor
                          key={`${selected.id}-${field.key}-${JSON.stringify(fieldValue ?? selectedDefaults[field.key])}`}
                          field={field}
                          value={fieldValue}
                          fallback={selectedDefaults[field.key]}
                          disabled={inspectorDisabled}
                          runtimeOptions={runtimeOptions}
                          onChange={value => {
                            if (field.key !== "subflowId")
                              return updateConfigField(field.key, value);
                            const selectedSubflow = subflows.find(
                              subflow =>
                                subflow.id === value && subflow.isEnabled
                            );
                            updateConfigFields({
                              subflowId: value,
                              zlcxz: selectedSubflow
                                ? {
                                    id: selectedSubflow.id,
                                    text: selectedSubflow.name,
                                  }
                                : { id: "", text: "" },
                            });
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              )}
              {!readOnly && (
                <div className="p-4 pt-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full rounded-lg"
                    disabled={inspectorDisabled}
                    onClick={() => {
                      const name = window.prompt(
                        "节点模板名称",
                        String(selected.data.label ?? "未命名模板")
                      );
                      if (name?.trim())
                        onSaveTemplate?.({
                          name: name.trim(),
                          nodeType: selected.data
                            .kind as ReuseTemplate["nodeType"],
                          config: selectedConfig,
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
            <div className="m-4 mt-8 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm leading-6 text-indigo-800">
              <p className="font-semibold">已选中连线</p>
              <p className="mt-1 text-xs">
                可点击顶部“删除连线”，或按 Delete /
                Backspace。删除后可立即撤销。
              </p>
            </div>
          ) : (
            <div className="m-4 mt-8 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
              <p className="font-medium text-slate-700">暂无配置信息</p>
              <p className="mt-1">
                请选择画布中的元件查看配置信息；若无元件，请添加元件。
              </p>
            </div>
          ))}
        {inspectorMode !== "compact" && !readOnly && (
          <div className="border-t border-slate-100 p-4">
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                管理我的模板与子流程
              </summary>
              <div className="mt-3 grid gap-2 text-xs">
                {templates.map(template => (
                  <div
                    key={template.id}
                    className="flex items-center gap-1 rounded border border-slate-100 bg-slate-50 p-2"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {template.name}
                    </span>
                    <button
                      type="button"
                      className="text-indigo-700 hover:underline"
                      onClick={() => {
                        const name = window.prompt("模板名称", template.name);
                        if (name?.trim() && name !== template.name)
                          onUpdateTemplate?.(template, { name: name.trim() });
                      }}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      className="text-indigo-700 hover:underline"
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
                    className="flex items-center gap-1 rounded border border-violet-100 bg-violet-50 p-2"
                  >
                    <FolderTree size={12} className="text-violet-600" />
                    <span className="min-w-0 flex-1 truncate">
                      {subflow.name}
                    </span>
                    <button
                      type="button"
                      className="text-violet-700 hover:underline"
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
                  <p className="text-slate-400">
                    从选中节点保存模板，或在设计器顶部将当前流程保存为子流程。
                  </p>
                )}
              </div>
            </details>
          </div>
        )}
      </aside>
    </div>
  );
}
