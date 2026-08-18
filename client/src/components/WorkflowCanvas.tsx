import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces, CircleDot, FileText, FolderTree, GitBranch, Globe2, Play, Plus, Save, Sparkles, Square, Trash2, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Definition } from "../../../server/workflow-service";

type NodeKind = Definition["nodes"][number]["type"];
type NodeConfig = Record<string, unknown>;
type ReuseTemplate = { id: string; name: string; nodeType: Exclude<NodeKind, "start" | "end" | "subflow">; config: NodeConfig };
type ReuseSubflow = { id: string; name: string; isEnabled: boolean };

type FlowType = "state" | "control" | "data";
const palette: Array<{ type: NodeKind; label: string; description: string; icon: typeof Play; color: string; flowTypes: FlowType[]; defaultConfig: NodeConfig }> = [
  { type: "start", label: "开始", description: "初始化输入变量", icon: Play, color: "#10b981", flowTypes: ["state", "control", "data"], defaultConfig: { initialVariables: {} } },
  { type: "llm", label: "LLM", description: "调用运行时模型目录", icon: Sparkles, color: "#4f46e5", flowTypes: ["state", "control", "data"], defaultConfig: { systemPrompt: "你是一名严谨的工作流助手。", prompt: "{{input.prompt}}" } },
  { type: "http", label: "HTTP", description: "受限的外部请求", icon: Globe2, color: "#d97706", flowTypes: ["state", "control", "data"], defaultConfig: { method: "GET", url: "https://jsonplaceholder.typicode.com/todos/{{input.id}}" } },
  { type: "transform", label: "转换", description: "字段映射与变量加工", icon: Braces, color: "#0891b2", flowTypes: ["state", "control", "data"], defaultConfig: { mappings: {} } },
  { type: "condition", label: "条件", description: "true / false 分支", icon: GitBranch, color: "#8b5cf6", flowTypes: ["state", "control", "data"], defaultConfig: { left: "{{input.value}}", operator: "equals", right: true, trueHandle: "true", falseHandle: "false" } },
  { type: "state", label: "状态", description: "原始状态流程的状态节点", icon: CircleDot, color: "#2563eb", flowTypes: ["state", "control"], defaultConfig: { stateCode: "STATE_CODE", displayName: "业务状态" } },
  { type: "operate", label: "操作", description: "人工或系统操作命令", icon: Play, color: "#db2777", flowTypes: ["state", "control"], defaultConfig: { commandCode: "COMMAND_CODE", assigneeMode: "role" } },
  { type: "router", label: "路由", description: "原始控制流程分发节点", icon: Waypoints, color: "#7c3aed", flowTypes: ["control"], defaultConfig: { routes: [] } },
  { type: "rest", label: "REST", description: "原始流程 REST 调用节点", icon: Globe2, color: "#ea580c", flowTypes: ["control", "data"], defaultConfig: { method: "POST", endpoint: "" } },
  { type: "form", label: "表单", description: "流程实例表单与字段定义", icon: FileText, color: "#0f766e", flowTypes: ["state", "control"], defaultConfig: { fields: [] } },
  { type: "sql", label: "SQL", description: "数据流程 SQL 节点（需数据源）", icon: Braces, color: "#475569", flowTypes: ["data"], defaultConfig: { datasourceId: "", statement: "SELECT 1" } },
  { type: "end", label: "结束", description: "输出最终结果", icon: Square, color: "#ef4444", flowTypes: ["state", "control", "data"], defaultConfig: { resultTemplate: "{{vars}}" } },
];

function defaultDefinition(): Definition {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "开始", position: { x: 90, y: 200 }, config: { initialVariables: {} } },
      { id: "end", type: "end", name: "结束", position: { x: 510, y: 200 }, config: { resultTemplate: "{{vars}}" } },
    ],
    edges: [{ id: "start-end", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "end" }],
  };
}

function colorFor(kind: NodeKind) {
  return palette.find(item => item.type === kind)?.color ?? "#64748b";
}

function toFlowNodes(definition: Definition): Node[] {
  return definition.nodes.map(node => ({
    id: node.id,
    type: "default",
    position: node.position,
    data: { label: node.name, kind: node.type, config: node.config },
    style: { border: `2px solid ${colorFor(node.type)}`, borderRadius: 8, boxShadow: "0 10px 22px rgba(15, 23, 42, .08)", minWidth: 150, fontWeight: 600 },
  }));
}

function toFlowEdges(definition: Definition): Edge[] {
  return definition.edges.map(edge => ({ id: edge.id, source: edge.sourceNodeId, sourceHandle: edge.sourceHandle, target: edge.targetNodeId, animated: true, style: { stroke: "#94a3b8", strokeWidth: 1.7 } }));
}

function toDefinition(nodes: Node[], edges: Edge[], base: Definition): Definition {
  return {
    ...base,
    nodes: nodes.map(node => ({
      id: node.id,
      type: (node.data.kind as NodeKind) ?? "transform",
      name: String(node.data.label ?? "未命名节点"),
      position: node.position,
      config: (node.data.config as NodeConfig) ?? {},
    })),
    edges: edges.map(edge => ({ id: edge.id, sourceNodeId: edge.source, sourceHandle: edge.sourceHandle ?? undefined, targetNodeId: edge.target })),
  };
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
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configText, setConfigText] = useState("{}");
  const baseRef = useRef<Definition>(initial);

  useEffect(() => {
    const next = definition ?? defaultDefinition();
    baseRef.current = next;
    setNodes(toFlowNodes(next));
    setEdges(toFlowEdges(next));
    setSelectedId(null);
  }, [workflowId, setEdges, setNodes]);

  useEffect(() => {
    if (onDefinitionChange) onDefinitionChange(toDefinition(nodes, edges, baseRef.current));
  }, [edges, nodes, onDefinitionChange]);

  const selected = useMemo(() => nodes.find(node => node.id === selectedId), [nodes, selectedId]);
  useEffect(() => {
    if (selected) setConfigText(JSON.stringify(selected.data.config ?? {}, null, 2));
  }, [selected]);

  const addNode = (item: (typeof palette)[number]) => {
    if (readOnly) return;
    const suffix = Math.random().toString(36).slice(2, 7);
    setNodes(current => current.concat({
      id: `${item.type}-${suffix}`,
      type: "default",
      position: { x: 260 + current.length * 26, y: 100 + (current.length % 4) * 95 },
      data: { label: item.label, kind: item.type, config: item.defaultConfig },
      style: { border: `2px solid ${item.color}`, borderRadius: 8, boxShadow: "0 10px 22px rgba(15, 23, 42, .08)", minWidth: 150, fontWeight: 600 },
    }));
  };

  const addReusableNode = (input: { type: NodeKind; label: string; config: NodeConfig; color?: string }) => {
    if (readOnly) return;
    const suffix = Math.random().toString(36).slice(2, 7);
    const color = input.color ?? colorFor(input.type);
    setNodes(current => current.concat({
      id: `${input.type}-${suffix}`,
      type: "default",
      position: { x: 260 + current.length * 26, y: 100 + (current.length % 4) * 95 },
      data: { label: input.label, kind: input.type, config: input.config },
      style: { border: `2px solid ${color}`, borderRadius: 8, boxShadow: "0 10px 22px rgba(15, 23, 42, .08)", minWidth: 150, fontWeight: 600 },
    }));
  };

  const onConnect = useCallback((connection: Connection) => {
    if (!readOnly) setEdges(current => addEdge({ ...connection, id: `edge-${Date.now()}`, animated: true, style: { stroke: "#94a3b8", strokeWidth: 1.7 } }, current));
  }, [readOnly, setEdges]);

  const updateSelected = (updates: Partial<{ label: string; config: NodeConfig }>) => {
    if (!selectedId || readOnly) return;
    setNodes(current => current.map(node => node.id === selectedId ? { ...node, data: { ...node.data, ...updates } } : node));
  };

  const applyConfig = () => {
    try {
      const parsed = JSON.parse(configText) as NodeConfig;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      updateSelected({ config: parsed });
    } catch {
      window.alert("节点配置必须是合法的 JSON 对象。");
    }
  };

  return (
    <div className="grid min-h-[650px] grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 bg-slate-50">
        <div className="flex min-h-14 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3">
          {palette.filter(item => item.flowTypes.includes(flowType)).map(item => (
            <Button key={item.type} type="button" variant="ghost" size="sm" className="gap-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-950" disabled={readOnly} onClick={() => addNode(item)} title={item.description}>
              <item.icon size={14} color={item.color} />{item.label}
            </Button>
          ))}
          {!readOnly && <span className="ml-auto flex items-center gap-1 text-xs text-slate-400"><Plus size={13} />拖入或添加节点</span>}
        </div>
        {!readOnly && (templates.length > 0 || subflows.length > 0) && <div className="flex min-h-11 items-center gap-2 overflow-x-auto border-b border-slate-100 bg-slate-50 px-3 py-1.5"><span className="shrink-0 text-[10px] font-bold tracking-[.14em] text-slate-400">REUSE LIBRARY</span>{templates.map(template => <Button key={template.id} type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-xs" onClick={() => addReusableNode({ type: template.nodeType, label: template.name, config: template.config })}><Save size={12} />{template.name}</Button>)}{subflows.filter(subflow => subflow.isEnabled).map(subflow => <Button key={subflow.id} type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 border-violet-200 text-xs text-violet-700 hover:bg-violet-50" onClick={() => addReusableNode({ type: "subflow", label: subflow.name, config: { subflowId: subflow.id }, color: "#7c3aed" })}><FolderTree size={12} />{subflow.name}</Button>)}</div>}
        <div className="h-[420px] sm:h-[590px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            fitView
          >
            <Background color="#d9e2ec" gap={20} size={1} />
            <MiniMap nodeColor={node => colorFor((node.data.kind as NodeKind) ?? "transform")} pannable zoomable />
            <Controls showInteractive={!readOnly} />
          </ReactFlow>
        </div>
      </section>
      <aside className="border-t border-slate-200 bg-white p-4 lg:border-l lg:border-t-0 lg:p-5">
        <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold tracking-[.2em] text-indigo-600">NODE INSPECTOR</p><h2 className="mt-1 text-sm font-semibold text-slate-900">节点配置</h2></div><Save size={16} className="text-slate-300" /></div>
        {selected ? <div className="mt-5 space-y-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">节点名称
            <input className="h-9 rounded-md border border-slate-200 px-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50" value={String(selected.data.label ?? "")} disabled={readOnly} onChange={event => updateSelected({ label: event.target.value })} />
          </label>
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600"><span className="font-semibold text-slate-700">{String(selected.data.kind)}</span><p className="mt-1 leading-5">使用 <code className="rounded bg-white px-1 text-indigo-600">{"{{input.field}}"}</code> 或 <code className="rounded bg-white px-1 text-indigo-600">{"{{nodes.节点ID.字段}}"}</code> 读取运行上下文。</p></div>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">JSON 配置
            <textarea className="min-h-64 rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-emerald-200 outline-none focus:border-indigo-400 disabled:opacity-70" value={configText} disabled={readOnly} onChange={event => setConfigText(event.target.value)} />
          </label>
          {!readOnly && <div className="grid gap-2"><Button type="button" size="sm" className="w-full" onClick={applyConfig}>应用配置</Button>{selected.data.kind !== "start" && selected.data.kind !== "end" && selected.data.kind !== "subflow" && onSaveTemplate && <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => { const name = window.prompt("节点模板名称", String(selected.data.label ?? "未命名模板")); if (name?.trim()) onSaveTemplate({ name: name.trim(), nodeType: selected.data.kind as ReuseTemplate["nodeType"], config: selected.data.config as NodeConfig }); }}><Save size={13} />保存为节点模板</Button>}</div>}
        </div> : <div className="mt-8 rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">选择画布节点以编辑名称与 JSON 配置。条件节点使用 <strong>true</strong> 和 <strong>false</strong> 源句柄连接两个分支。</div>}
        {!readOnly && <details className="mt-5 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-xs font-semibold text-slate-700">管理我的模板与子流程</summary><div className="mt-3 grid gap-2 text-xs">{templates.map(template => <div key={template.id} className="flex items-center gap-1 rounded border border-slate-100 bg-slate-50 p-2"><span className="min-w-0 flex-1 truncate">{template.name}</span><button type="button" className="text-indigo-700 hover:underline" onClick={() => { const name = window.prompt("模板名称", template.name); if (name?.trim() && name !== template.name) onUpdateTemplate?.(template, { name: name.trim() }); }}>改名</button><button type="button" className="text-indigo-700 hover:underline" onClick={() => { const raw = window.prompt("模板 JSON 配置", JSON.stringify(template.config, null, 2)); if (!raw) return; try { const config = JSON.parse(raw); if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(); onUpdateTemplate?.(template, { config }); } catch { window.alert("模板配置必须是合法的 JSON 对象。"); } }}>配置</button><button type="button" className="text-red-600 hover:underline" onClick={() => onDeleteTemplate?.(template.id)}><Trash2 size={12} /></button></div>)}{subflows.map(subflow => <div key={subflow.id} className="flex items-center gap-1 rounded border border-violet-100 bg-violet-50 p-2"><FolderTree size={12} className="text-violet-600" /><span className="min-w-0 flex-1 truncate">{subflow.name}</span><button type="button" className="text-violet-700 hover:underline" onClick={() => onToggleSubflow?.(subflow, !subflow.isEnabled)}>{subflow.isEnabled ? "停用" : "启用"}</button><button type="button" className="text-red-600 hover:underline" onClick={() => onDeleteSubflow?.(subflow.id)}><Trash2 size={12} /></button></div>)}{!templates.length && !subflows.length && <p className="text-slate-400">从选中节点保存模板，或在设计器顶部将当前流程保存为子流程。</p>}</div></details>}
        {!readOnly && templates.length > 0 && onUpdateTemplate && <TemplateConfigurationEditor templates={templates} onUpdate={onUpdateTemplate} />}
      </aside>
    </div>
  );
}

function TemplateConfigurationEditor({ templates, onUpdate }: { templates: ReuseTemplate[]; onUpdate: (template: ReuseTemplate, updates: { config?: NodeConfig }) => void }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const selected = templates.find(template => template.id === templateId) ?? templates[0];
  const [draft, setDraft] = useState(() => JSON.stringify(selected?.config ?? {}, null, 2));
  useEffect(() => { setTemplateId(current => templates.some(template => template.id === current) ? current : templates[0]?.id ?? ""); }, [templates]);
  useEffect(() => { if (selected) setDraft(JSON.stringify(selected.config, null, 2)); }, [selected?.id]);
  return <section className="mt-3 rounded border border-indigo-100 bg-indigo-50 p-3"><p className="text-xs font-semibold text-indigo-900">编辑模板配置</p><select aria-label="选择要编辑的模板" className="mt-2 h-8 w-full rounded border border-indigo-200 bg-white px-2 text-xs" value={selected?.id ?? ""} onChange={event => setTemplateId(event.target.value)}>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select><textarea aria-label="模板 JSON 配置编辑器" className="mt-2 min-h-28 w-full rounded border border-indigo-200 bg-slate-950 p-2 font-mono text-[11px] leading-5 text-emerald-200" value={draft} onChange={event => setDraft(event.target.value)} /><Button type="button" size="sm" className="mt-2 w-full" onClick={() => { if (!selected) return; try { const config = JSON.parse(draft); if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(); onUpdate(selected, { config }); } catch { window.alert("模板配置必须是合法的 JSON 对象。"); } }}>保存模板配置</Button></section>;
}
