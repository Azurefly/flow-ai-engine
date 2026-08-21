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
import { Braces, CircleDot, Database, Download, FileText, Filter, FolderTree, GitBranch, Globe2, LockKeyhole, Maximize2, Minimize2, MousePointer2, Move, Play, Plus, Save, Sigma, Sparkles, Square, Table2, Trash2, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Definition } from "../../../server/workflow-service";
import { createDefaultNodeConfig, FLOW_NODE_DEFINITIONS, getNodeConfigEvidence, type FlowNodeDefinition, type FlowNodeType, type FlowType, type NodeConfig, validateNodeConfig } from "@shared/workflow-node-contract";

type NodeKind = FlowNodeType;
type FlowNodeData = { label: string; kind: NodeKind; config: NodeConfig };
type CanvasNode = Node<FlowNodeData, "workflowNode">;
type ReuseTemplate = { id: string; name: string; nodeType: Exclude<NodeKind, "start" | "end" | "subflow">; config: NodeConfig };
type ReuseSubflow = { id: string; name: string; isEnabled: boolean };
type InspectorMode = "normal" | "compact" | "maximized";
type ConfigState = "partial" | "editing" | "complete";

const nodeAppearance: Record<NodeKind, { icon: typeof Play; color: string }> = {
  start: { icon: Play, color: "#10b981" },
  end: { icon: Square, color: "#ef4444" },
  state: { icon: CircleDot, color: "#2563eb" },
  operate: { icon: Play, color: "#db2777" },
  router: { icon: Waypoints, color: "#7c3aed" },
  rest: { icon: Globe2, color: "#ea580c" },
  form: { icon: FileText, color: "#0f766e" },
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
  edit_sql: { icon: Braces, color: "#475569" },
  udf: { icon: Sigma, color: "#b45309" },
  sink: { icon: FileText, color: "#be123c" },
  output: { icon: FileText, color: "#be123c" },
};

const palette: Array<FlowNodeDefinition & { icon: typeof Play; color: string }> = (Object.values(FLOW_NODE_DEFINITIONS) as FlowNodeDefinition[]).map(item => ({ ...item, ...nodeAppearance[item.type] }));

function nodeConfigState(kind: NodeKind, config: NodeConfig): ConfigState {
  try {
    validateNodeConfig(kind, config);
    const defaultConfig = createDefaultNodeConfig(kind);
    return Object.keys(config).some(key => JSON.stringify(config[key]) !== JSON.stringify(defaultConfig[key])) ? "complete" : "editing";
  } catch {
    return "partial";
  }
}

function sourceHandles(kind: NodeKind, config: NodeConfig) {
  if (kind === "end") return [];
  if (kind === "condition") return ["true", "false"];
  if (kind === "router") {
    const configured = Array.isArray(config.routes) ? config.routes.map(route => route && typeof route === "object" ? String((route as NodeConfig).handle ?? "") : "").filter(Boolean) : [];
    return Array.from(new Set(["default", String(config.defaultRoute ?? ""), ...configured].filter(Boolean)));
  }
  return ["default"];
}

function FlowNodeCard({ data, selected }: NodeProps) {
  const nodeData = data as unknown as FlowNodeData;
  const appearance = nodeAppearance[nodeData.kind];
  const configState = nodeConfigState(nodeData.kind, nodeData.config);
  const handles = sourceHandles(nodeData.kind, nodeData.config);
  const hasTarget = nodeData.kind !== "start";
  return (
    <div className={`relative min-w-40 rounded-[2px] border-2 bg-white px-3 py-2 shadow-none ${selected ? "ring-2 ring-indigo-200" : ""}`} style={{ borderColor: appearance.color }}>
      {hasTarget && <Handle type="target" position={Position.Left} id="target" className="!h-2.5 !w-2.5 !border-2 !border-white" style={{ backgroundColor: appearance.color }} />}
      <div className="flex items-center gap-2">
        <appearance.icon size={15} color={appearance.color} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{nodeData.label}</span>
        <span className={`h-2 w-2 rounded-full ${configState === "partial" ? "bg-red-500" : configState === "editing" ? "bg-blue-500" : "bg-emerald-500"}`} title={configState === "partial" ? "未完全配置" : configState === "editing" ? "配置中" : "已配置"} />
      </div>
      <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-[.12em] text-slate-400">{nodeData.kind}</p>
      {handles.map((id, index) => <Handle key={id} type="source" position={Position.Right} id={id} className="!h-2.5 !w-2.5 !border-2 !border-white" style={{ top: `${((index + 1) / (handles.length + 1)) * 100}%`, backgroundColor: appearance.color }} title={id} />)}
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
      { id: "start", type: "start", name: "开始", position: { x: 90, y: 200 }, config: createDefaultNodeConfig("start") },
      { id: "end", type: "end", name: "结束", position: { x: 510, y: 200 }, config: createDefaultNodeConfig("end") },
    ],
    edges: [{ id: "start-end", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "end" }],
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
  return definition.edges.map(edge => ({ id: edge.id, source: edge.sourceNodeId, sourceHandle: edge.sourceHandle, target: edge.targetNodeId, targetHandle: "target", animated: true, style: { stroke: "#94a3b8", strokeWidth: 1.7 } }));
}

function toDefinition(nodes: Node[], edges: Edge[], base: Definition): Definition {
  return {
    ...base,
    nodes: nodes.map(node => ({
      id: node.id,
      type: (node.data as FlowNodeData).kind,
      name: String((node.data as FlowNodeData).label ?? "未命名节点"),
      position: node.position,
      config: (node.data as FlowNodeData).config ?? {},
    })),
    edges: edges.map(edge => ({ id: edge.id, sourceNodeId: edge.source, sourceHandle: edge.sourceHandle ?? undefined, targetNodeId: edge.target })),
  };
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function ConfigFieldEditor({ field, value, fallback, disabled, onChange }: { field: FlowNodeDefinition["fields"][number]; value: unknown; fallback: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const effectiveValue = value ?? fallback;
  const label = <span className="flex items-center gap-1 text-xs font-semibold text-slate-700">{field.required && <i className="not-italic text-red-500">*</i>}{field.label}</span>;
  const inputClass = "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400";
  if (field.kind === "select") return <label className="grid gap-1.5">{label}<select className={inputClass} disabled={disabled} value={String(effectiveValue ?? "")} onChange={event => onChange(event.target.value)}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldHelp help={field.help} /></label>;
  if (field.kind === "textarea") return <label className="grid gap-1.5">{label}<textarea key={String(effectiveValue ?? "")} className="min-h-20 w-full rounded-md border border-slate-200 bg-white p-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400" defaultValue={String(effectiveValue ?? "")} disabled={disabled} onBlur={event => onChange(event.target.value)} /><FieldHelp help={field.help} /></label>;
  if (field.kind === "json") return <StructuredValueEditor key={JSON.stringify(effectiveValue)} field={field} value={effectiveValue} disabled={disabled} onChange={onChange} />;
  if (field.kind === "template" && effectiveValue && typeof effectiveValue === "object") return <StructuredValueEditor key={JSON.stringify(effectiveValue)} field={field} value={effectiveValue} disabled={disabled} onChange={onChange} />;
  if (field.kind === "number") return <label className="grid gap-1.5">{label}<input key={String(effectiveValue ?? "")} type="number" className={inputClass} defaultValue={effectiveValue === undefined || effectiveValue === null ? "" : String(effectiveValue)} disabled={disabled} onBlur={event => onChange(event.target.value === "" ? "" : Number(event.target.value))} /><FieldHelp help={field.help} /></label>;
  return <label className="grid gap-1.5">{label}<input key={String(effectiveValue ?? "")} className={inputClass} defaultValue={String(effectiveValue ?? "")} disabled={disabled} onBlur={event => onChange(event.target.value)} /><FieldHelp help={field.help} /></label>;
}

function structuredValue(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function StructuredValueEditor({ field, value, disabled, onChange }: { field: FlowNodeDefinition["fields"][number]; value: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const isList = Array.isArray(value);
  const objectEntries = !isList && value && typeof value === "object" ? Object.entries(value as Record<string, unknown>) : [];
  const list = isList ? value : [];
  const inputClass = "h-8 min-w-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50";
  const updateObject = (entries: Array<[string, unknown]>) => onChange(Object.fromEntries(entries.filter(([key]) => key.trim())));
  const updateList = (next: unknown[]) => onChange(next);
  const newListItem = field.key === "routes" ? { handle: "route", label: "新分支", condition: { left: "{{input.value}}", operator: "equals", right: "" } } : field.key === "fields" ? { key: "field", label: "字段名称", type: "text", required: false } : "";
  return <fieldset className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5"><legend className="px-1 text-xs font-semibold text-slate-700">{field.required && <i className="mr-1 not-italic text-red-500">*</i>}{field.label}</legend>{isList ? <div className="grid gap-2">{list.map((item, index) => <StructuredListRow key={`${field.key}-${index}`} fieldKey={field.key} item={item} disabled={disabled} onChange={next => updateList(list.map((current, itemIndex) => itemIndex === index ? next : current))} onRemove={() => updateList(list.filter((_, itemIndex) => itemIndex !== index))} />)}<Button type="button" size="sm" variant="outline" className="w-fit text-xs" disabled={disabled} onClick={() => updateList([...list, newListItem])}><Plus size={13} />添加一项</Button></div> : <div className="grid gap-2">{objectEntries.map(([key, entryValue], index) => <div key={`${key}-${index}`} className="grid grid-cols-[minmax(88px,.8fr)_minmax(0,1.2fr)_auto] gap-2"><input className={inputClass} value={key} disabled={disabled} aria-label={`${field.label}名称`} onChange={event => updateObject(objectEntries.map(([currentKey, currentValue], itemIndex) => itemIndex === index ? [event.target.value, currentValue] : [currentKey, currentValue]))} /><input className={inputClass} value={String(entryValue ?? "")} disabled={disabled} aria-label={`${field.label}${key}的值`} onChange={event => updateObject(objectEntries.map(([currentKey, currentValue], itemIndex) => itemIndex === index ? [currentKey, structuredValue(event.target.value)] : [currentKey, currentValue]))} /><button type="button" className="rounded px-1 text-slate-400 hover:text-red-600" disabled={disabled} onClick={() => updateObject(objectEntries.filter((_, itemIndex) => itemIndex !== index))} aria-label={`删除${key}`}><Trash2 size={14} /></button></div>)}<Button type="button" size="sm" variant="outline" className="w-fit text-xs" disabled={disabled} onClick={() => updateObject([...objectEntries, ["字段名", ""]])}><Plus size={13} />添加字段</Button></div>}<FieldHelp help={field.help.replace(/JSON (对象|数组|标量)/g, "结构化字段")} /></fieldset>;
}

function StructuredListRow({ fieldKey, item, disabled, onChange, onRemove }: { fieldKey: string; item: unknown; disabled: boolean; onChange: (value: unknown) => void; onRemove: () => void }) {
  const inputClass = "h-8 min-w-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50";
  if (fieldKey === "routes") { const route = item && typeof item === "object" ? item as NodeConfig : {}; const condition = route.condition && typeof route.condition === "object" ? route.condition as NodeConfig : {}; return <div className="grid gap-2 rounded border border-slate-200 bg-white p-2"><div className="grid grid-cols-[1fr_1fr_auto] gap-2"><input className={inputClass} placeholder="分支句柄" value={String(route.handle ?? "")} disabled={disabled} onChange={event => onChange({ ...route, handle: event.target.value })} /><input className={inputClass} placeholder="显示名称" value={String(route.label ?? "")} disabled={disabled} onChange={event => onChange({ ...route, label: event.target.value })} /><button type="button" className="text-slate-400 hover:text-red-600" disabled={disabled} onClick={onRemove} aria-label="删除路由规则"><Trash2 size={14} /></button></div><div className="grid grid-cols-[1fr_120px_1fr] gap-2"><input className={inputClass} placeholder="左值" value={String(condition.left ?? "")} disabled={disabled} onChange={event => onChange({ ...route, condition: { ...condition, left: event.target.value } })} /><select className={inputClass} value={String(condition.operator ?? "equals")} disabled={disabled} onChange={event => onChange({ ...route, condition: { ...condition, operator: event.target.value } })}><option value="equals">等于</option><option value="notEquals">不等于</option><option value="contains">包含</option><option value="exists">存在</option><option value="greaterThan">大于</option><option value="lessThan">小于</option></select><input className={inputClass} placeholder="右值" value={String(condition.right ?? "")} disabled={disabled} onChange={event => onChange({ ...route, condition: { ...condition, right: structuredValue(event.target.value) } })} /></div></div>; }
  if (fieldKey === "fields") { const itemField = item && typeof item === "object" ? item as NodeConfig : {}; return <div className="grid grid-cols-[1fr_1fr_100px_auto_auto] items-center gap-2 rounded border border-slate-200 bg-white p-2"><input className={inputClass} placeholder="字段标识" value={String(itemField.key ?? "")} disabled={disabled} onChange={event => onChange({ ...itemField, key: event.target.value })} /><input className={inputClass} placeholder="显示名称" value={String(itemField.label ?? "")} disabled={disabled} onChange={event => onChange({ ...itemField, label: event.target.value })} /><select className={inputClass} value={String(itemField.type ?? "text")} disabled={disabled} onChange={event => onChange({ ...itemField, type: event.target.value })}><option value="text">文本</option><option value="number">数字</option><option value="date">日期</option><option value="select">选项</option></select><label className="flex items-center gap-1 text-[11px] text-slate-600"><input type="checkbox" checked={Boolean(itemField.required)} disabled={disabled} onChange={event => onChange({ ...itemField, required: event.target.checked })} />必填</label><button type="button" className="text-slate-400 hover:text-red-600" disabled={disabled} onClick={onRemove} aria-label="删除表单字段"><Trash2 size={14} /></button></div>; }
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"><input className={inputClass} value={String(item ?? "")} disabled={disabled} onChange={event => onChange(structuredValue(event.target.value))} /><button type="button" className="text-slate-400 hover:text-red-600" disabled={disabled} onClick={onRemove} aria-label="删除列表项"><Trash2 size={14} /></button></div>;
}

function FieldHelp({ help }: { help: string }) {
  return <p className="text-[11px] leading-4 text-slate-500">{help}</p>;
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
}: {
  workflowId?: string;
  flowType?: FlowType;
  definition?: Definition | null;
  readOnly?: boolean;
  onDefinitionChange?: (definition: Definition) => void;
  templates?: ReuseTemplate[];
  subflows?: ReuseSubflow[];
  onSaveTemplate?: (template: Omit<ReuseTemplate, "id">) => void;
  onUpdateTemplate?: (template: ReuseTemplate, updates: { name?: string; config?: NodeConfig }) => void;
  onDeleteTemplate?: (id: string) => void;
  onToggleSubflow?: (subflow: ReuseSubflow, isEnabled: boolean) => void;
  onDeleteSubflow?: (id: string) => void;
}) {
  const initial = definition ?? defaultDefinition();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(toFlowNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [advancedConfigText, setAdvancedConfigText] = useState("{}");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("normal");
  const [inspectorLocked, setInspectorLocked] = useState(false);
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<Definition>(initial);
  const appliedDefinitionRef = useRef("");
  const emittedDefinitionRef = useRef("");
  const appliedWorkflowRef = useRef<string | undefined>(undefined);
  const definitionSignature = useMemo(() => JSON.stringify(definition ?? defaultDefinition()), [definition]);

  useEffect(() => {
    if (emittedDefinitionRef.current === definitionSignature) {
      appliedDefinitionRef.current = definitionSignature;
      appliedWorkflowRef.current = workflowId;
      return;
    }
    if (appliedWorkflowRef.current === workflowId && appliedDefinitionRef.current === definitionSignature) return;
    const next = definition ?? defaultDefinition();
    baseRef.current = next;
    appliedWorkflowRef.current = workflowId;
    appliedDefinitionRef.current = definitionSignature;
    setNodes(toFlowNodes(next));
    setEdges(toFlowEdges(next));
    setSelectedId(current => current && next.nodes.some(node => node.id === current) ? current : null);
  }, [definition, definitionSignature, workflowId, setEdges, setNodes]);

  useEffect(() => {
    if (!onDefinitionChange) return;
    const next = toDefinition(nodes, edges, baseRef.current);
    emittedDefinitionRef.current = JSON.stringify(next);
    onDefinitionChange(next);
  }, [edges, nodes, onDefinitionChange]);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === canvasRegionRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const inspect = () => {
      const next = nodes.find(node => !["start", "end"].includes(node.data.kind)) ?? nodes[0];
      if (!next) return;
      setSelectedId(next.id);
      setInspectorMode("normal");
      canvasRegionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      reactFlow?.fitView({ nodes: [next], padding: 0.6, duration: 180 });
    };
    window.addEventListener("flow:inspect-node", inspect);
    return () => window.removeEventListener("flow:inspect-node", inspect);
  }, [nodes, reactFlow]);

  const selected = useMemo(() => nodes.find(node => node.id === selectedId), [nodes, selectedId]);
  const selectedDefinition = selected ? (() => { const item = FLOW_NODE_DEFINITIONS[selected.data.kind]; return getNodeConfigEvidence(selected.data.kind) === "compatibility-extension" ? { ...item, description: `${item.description} 当前裁剪安装包未保留节点打包脚本；以下字段按安全兼容契约呈现，并会保留未知扩展字段。` } : item; })() : null;
  const selectedConfig = (selected?.data.config ?? {}) as NodeConfig;
  const selectedDefaults = selected ? createDefaultNodeConfig(selected.data.kind) : {};
  const selectedConfigState = selected ? nodeConfigState(selected.data.kind, selectedConfig) : null;
  const inspectorDisabled = readOnly || inspectorLocked;

  useEffect(() => {
    if (selected) setAdvancedConfigText(JSON.stringify(selected.data.config ?? {}, null, 2));
  }, [selected]);

  const addNode = (item: (typeof palette)[number]) => {
    if (readOnly) return;
    const suffix = Math.random().toString(36).slice(2, 7);
    setNodes(current => current.concat({
      id: `${item.type}-${suffix}`,
      type: "workflowNode",
      position: { x: 260 + current.length * 26, y: 100 + (current.length % 4) * 95 },
      data: { label: item.label, kind: item.type, config: createDefaultNodeConfig(item.type) },
    }));
  };

  const addReusableNode = (input: { type: NodeKind; label: string; config: NodeConfig }) => {
    if (readOnly) return;
    const suffix = Math.random().toString(36).slice(2, 7);
    setNodes(current => current.concat({ id: `${input.type}-${suffix}`, type: "workflowNode", position: { x: 260 + current.length * 26, y: 100 + (current.length % 4) * 95 }, data: { label: input.label, kind: input.type, config: structuredClone(input.config) } }));
  };

  const onConnect = useCallback((connection: Connection) => {
    if (!readOnly) setEdges(current => addEdge({ ...connection, id: `edge-${Date.now()}`, targetHandle: "target", animated: true, style: { stroke: "#94a3b8", strokeWidth: 1.7 } }, current));
  }, [readOnly, setEdges]);

  const updateSelected = (updates: Partial<FlowNodeData>) => {
    if (!selectedId || inspectorDisabled) return;
    setNodes(current => current.map(node => node.id === selectedId ? { ...node, data: { ...node.data, ...updates } } : node));
  };

  const updateConfigField = (key: string, value: unknown) => updateSelected({ config: { ...selectedConfig, [key]: value } });

  const applyAdvancedConfig = () => {
    try {
      const parsed = JSON.parse(advancedConfigText) as NodeConfig;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      updateSelected({ config: parsed });
    } catch {
      window.alert("节点配置必须是合法的 JSON 对象。");
    }
  };

  const exportCanvasImage = () => {
    const width = Math.max(900, ...nodes.map(node => node.position.x + 240));
    const height = Math.max(520, ...nodes.map(node => node.position.y + 140));
    const byId = new Map(nodes.map(node => [node.id, node]));
    const lines = edges.map(edge => {
      const source = byId.get(edge.source); const target = byId.get(edge.target);
      return source && target ? `<line x1="${source.position.x + 164}" y1="${source.position.y + 43}" x2="${target.position.x}" y2="${target.position.y + 43}" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrow)" />` : "";
    }).join("");
    const cards = nodes.map(node => `<g><rect x="${node.position.x}" y="${node.position.y}" width="164" height="72" rx="10" fill="#ffffff" stroke="${colorFor(node.data.kind)}" stroke-width="2"/><text x="${node.position.x + 14}" y="${node.position.y + 30}" fill="#0f172a" font-size="14" font-family="Arial, sans-serif" font-weight="700">${escapeXml(node.data.label)}</text><text x="${node.position.x + 14}" y="${node.position.y + 52}" fill="#64748b" font-size="10" font-family="Arial, sans-serif">${escapeXml(node.data.kind.toUpperCase())}</text></g>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker></defs><rect width="100%" height="100%" fill="#f8fafc"/>${lines}${cards}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "flow-canvas.svg"; anchor.click(); URL.revokeObjectURL(url);
  };

  const toggleFullscreen = async () => {
    if (!canvasRegionRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await canvasRegionRef.current.requestFullscreen();
  };

  return (
    <div data-aiflow-workflow-canvas="" className={inspectorMode === "maximized" ? "grid min-h-[650px] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(0,1fr)_480px]" : inspectorMode === "compact" ? "grid min-h-[650px] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(0,1fr)_72px]" : "grid min-h-[650px] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(0,1fr)_320px]"}>
      <section ref={canvasRegionRef} className="min-w-0 bg-slate-50">
        <div className="flex min-h-14 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3">
          <div className="flex items-center gap-1 pr-2">
            {palette.filter(item => item.flowTypes.includes(flowType)).map(item => <Button key={item.type} type="button" variant="ghost" size="sm" className="gap-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-950" disabled={readOnly} onClick={() => addNode(item)} title={item.description}><item.icon size={14} color={item.color} />{item.label}</Button>)}
            {(flowType === "state" || flowType === "control") && <><span className="mx-1 h-5 w-px bg-slate-200" /><span aria-disabled="true" title="原始安装包中为禁用状态，项目资源接入后才可用" className="flex cursor-not-allowed items-center gap-1 rounded px-2 py-1.5 text-xs text-slate-300"><Database size={14} />业务资源</span><span aria-disabled="true" title="原始安装包中为禁用状态，物理资源接入后才可用" className="flex cursor-not-allowed items-center gap-1 rounded px-2 py-1.5 text-xs text-slate-300"><Table2 size={14} />物理资源</span></>}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-slate-200 pl-2">
            <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs text-slate-600" onClick={() => reactFlow?.fitView({ padding: 0.24, duration: 180 })} title="整理画布"><Waypoints size={14} />整理画布</Button>
            <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs text-slate-600" onClick={exportCanvasImage} title="保存为图片"><Download size={14} />保存为图片</Button>
            <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs text-slate-600" onClick={() => void toggleFullscreen()} title="全屏展示"><Maximize2 size={14} />{fullscreen ? "退出全屏" : "全屏展示"}</Button>
            <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs text-slate-600" onClick={() => setSelectedId(null)} title="取消高亮"><MousePointer2 size={14} />取消高亮</Button>
          </div>
        </div>
        {!readOnly && (templates.length > 0 || subflows.length > 0) && <div className="flex min-h-11 items-center gap-2 overflow-x-auto border-b border-slate-100 bg-slate-50 px-3 py-1.5"><span className="shrink-0 text-[10px] font-bold tracking-[.14em] text-slate-400">REUSE LIBRARY</span>{templates.map(template => <Button key={template.id} type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-xs" onClick={() => addReusableNode({ type: template.nodeType, label: template.name, config: template.config })}><Save size={12} />{template.name}</Button>)}{subflows.filter(subflow => subflow.isEnabled).map(subflow => <Button key={subflow.id} type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 border-violet-200 text-xs text-violet-700 hover:bg-violet-50" onClick={() => addReusableNode({ type: "subflow", label: subflow.name, config: { subflowId: subflow.id, input: "{{input}}" } })}><FolderTree size={12} />{subflow.name}</Button>)}</div>}
        <div className="relative h-[420px] sm:h-[590px]">
          <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-sm"><span className="font-semibold text-slate-700">配置状态</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-500" />未完全配置</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-500" />配置中</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />已配置</span></div>
          <div className="absolute bottom-3 left-3 z-10 hidden items-center gap-3 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-500 shadow-sm sm:flex"><span className="flex items-center gap-1"><Move size={13} />画布移动</span><span className="flex items-center gap-1"><Maximize2 size={13} />画布缩放</span><span className="flex items-center gap-1"><MousePointer2 size={13} />节点多选</span><span className="flex items-center gap-1"><Square size={12} />节点框选</span></div>
          <ReactFlow<CanvasNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setReactFlow} onNodesChange={readOnly ? undefined : onNodesChange} onEdgesChange={readOnly ? undefined : onEdgesChange} onConnect={onConnect} onNodeClick={(_, node) => setSelectedId(node.id)} nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable fitView>
            <Background color="#d9e2ec" gap={20} size={1} />
            <MiniMap nodeColor={node => colorFor((node.data as FlowNodeData).kind)} pannable zoomable />
            <Controls showInteractive={!readOnly} />
          </ReactFlow>
        </div>
      </section>
      <aside data-workflow-inspector className="border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
        <div className="flex min-h-16 items-center justify-between border-b border-slate-100 px-4 py-3"><div className={inspectorMode === "compact" ? "hidden" : ""}><p className="text-[10px] font-bold tracking-[.2em] text-indigo-600">CONFIGURATION</p><h2 className="mt-1 text-sm font-semibold text-slate-900">配置信息</h2></div><div className="ml-auto flex items-center gap-1"><button type="button" className={`rounded p-1.5 text-slate-500 hover:bg-slate-100 ${inspectorLocked ? "text-indigo-600" : ""}`} title={inspectorLocked ? "解除面板锁定" : "锁定配置面板"} onClick={() => setInspectorLocked(value => !value)}><LockKeyhole size={15} /></button><button type="button" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="最大化面板" onClick={() => setInspectorMode(value => value === "maximized" ? "normal" : "maximized")}><Maximize2 size={15} /></button><button type="button" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="最小化面板" onClick={() => setInspectorMode(value => value === "compact" ? "normal" : "compact")}><Minimize2 size={15} /></button></div></div>
        {inspectorMode !== "compact" && (selected && selectedDefinition ? <div className="max-h-[650px] space-y-4 overflow-y-auto p-4"><label className="grid gap-1.5 text-xs font-medium text-slate-600">节点名称<input className="h-9 rounded-md border border-slate-200 px-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50" value={String(selected.data.label ?? "")} disabled={inspectorDisabled} onChange={event => updateSelected({ label: event.target.value })} /></label><div className={`rounded-md border p-3 ${selectedConfigState === "partial" ? "border-red-200 bg-red-50" : selectedConfigState === "editing" ? "border-blue-200 bg-blue-50" : "border-emerald-200 bg-emerald-50"}`}><p className="text-xs font-semibold text-slate-700">{selectedDefinition.label} · {selectedConfigState === "partial" ? "未完全配置" : selectedConfigState === "editing" ? "配置中" : "已配置"}</p><p className="mt-1 text-[11px] leading-5 text-slate-600">{selectedDefinition.description}</p></div><div className="space-y-4">{selectedDefinition.fields.map(field => <ConfigFieldEditor key={`${selected.id}-${field.key}-${JSON.stringify(selectedConfig[field.key] ?? selectedDefaults[field.key])}`} field={field} value={selectedConfig[field.key]} fallback={selectedDefaults[field.key]} disabled={inspectorDisabled} onChange={value => updateConfigField(field.key, value)} />)}</div><details className="rounded-md border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">高级 JSON 配置（保留扩展字段）</summary><textarea className="mt-3 min-h-36 w-full rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-emerald-200 outline-none focus:border-indigo-400 disabled:opacity-70" value={advancedConfigText} disabled={inspectorDisabled} onChange={event => setAdvancedConfigText(event.target.value)} /><Button type="button" size="sm" className="mt-2 w-full" disabled={inspectorDisabled} onClick={applyAdvancedConfig}>应用 JSON 配置</Button></details>{!readOnly && <div className="grid gap-2"><Button type="button" size="sm" variant="outline" className="w-full" disabled={inspectorDisabled} onClick={() => { const name = window.prompt("节点模板名称", String(selected.data.label ?? "未命名模板")); if (name?.trim()) onSaveTemplate?.({ name: name.trim(), nodeType: selected.data.kind as ReuseTemplate["nodeType"], config: selectedConfig }); }}><Save size={13} />保存为节点模板</Button></div>}</div> : <div className="m-4 mt-8 rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500"><p className="font-medium text-slate-700">暂无配置信息</p><p className="mt-1">请选择画布中的元件查看配置信息；若无元件，请从工具栏添加节点。</p></div>)}
        {inspectorMode !== "compact" && !readOnly && <div className="border-t border-slate-100 p-4"><details><summary className="cursor-pointer text-xs font-semibold text-slate-700">管理我的模板与子流程</summary><div className="mt-3 grid gap-2 text-xs">{templates.map(template => <div key={template.id} className="flex items-center gap-1 rounded border border-slate-100 bg-slate-50 p-2"><span className="min-w-0 flex-1 truncate">{template.name}</span><button type="button" className="text-indigo-700 hover:underline" onClick={() => { const name = window.prompt("模板名称", template.name); if (name?.trim() && name !== template.name) onUpdateTemplate?.(template, { name: name.trim() }); }}>改名</button><button type="button" className="text-indigo-700 hover:underline" onClick={() => { const raw = window.prompt("模板 JSON 配置", JSON.stringify(template.config, null, 2)); if (!raw) return; try { const config = JSON.parse(raw); if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(); onUpdateTemplate?.(template, { config }); } catch { window.alert("模板配置必须是合法的 JSON 对象。"); } }}>配置</button><button type="button" className="text-red-600 hover:underline" onClick={() => onDeleteTemplate?.(template.id)}><Trash2 size={12} /></button></div>)}{subflows.map(subflow => <div key={subflow.id} className="flex items-center gap-1 rounded border border-violet-100 bg-violet-50 p-2"><FolderTree size={12} className="text-violet-600" /><span className="min-w-0 flex-1 truncate">{subflow.name}</span><button type="button" className="text-violet-700 hover:underline" onClick={() => onToggleSubflow?.(subflow, !subflow.isEnabled)}>{subflow.isEnabled ? "停用" : "启用"}</button><button type="button" className="text-red-600 hover:underline" onClick={() => onDeleteSubflow?.(subflow.id)}><Trash2 size={12} /></button></div>)}{!templates.length && !subflows.length && <p className="text-slate-400">从选中节点保存模板，或在设计器顶部将当前流程保存为子流程。</p>}</div></details></div>}
      </aside>
    </div>
  );
}
