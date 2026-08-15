import { addEdge, Background, Controls, MiniMap, ReactFlow, type Connection, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Braces, GitBranch, Globe2, Play, Sparkles, Square } from "lucide-react";

type NodeKind = "start" | "end" | "llm" | "condition" | "http" | "transform";
const palette: Array<{ type: NodeKind; label: string; icon: typeof Play }> = [{ type: "start", label: "开始", icon: Play }, { type: "end", label: "结束", icon: Square }, { type: "llm", label: "LLM", icon: Sparkles }, { type: "condition", label: "条件", icon: GitBranch }, { type: "http", label: "HTTP", icon: Globe2 }, { type: "transform", label: "转换", icon: Braces }];
const color: Record<NodeKind, string> = { start: "#16a34a", end: "#16a34a", llm: "#2563eb", condition: "#06b6d4", http: "#f59e0b", transform: "#64748b" };
export default function WorkflowCanvas() {
  const [nodes, setNodes] = useState<Node[]>([{ id: "start", position: { x: 100, y: 180 }, data: { label: "开始" }, style: { borderColor: color.start, borderWidth: 2 } }, { id: "end", position: { x: 420, y: 180 }, data: { label: "结束" }, style: { borderColor: color.end, borderWidth: 2 } }]);
  const [edges, setEdges] = useState<Edge[]>([{ id: "start-end", source: "start", target: "end", animated: true }]);
  const [selected, setSelected] = useState<string | null>(null);
  const addNode = (type: NodeKind) => setNodes(current => [...current, { id: `${type}-${Date.now()}`, position: { x: 220 + current.length * 24, y: 100 + current.length * 32 }, data: { label: palette.find(item => item.type === type)?.label ?? type }, style: { borderColor: color[type], borderWidth: 2 } }]);
  const onConnect = useCallback((connection: Connection) => setEdges(current => addEdge(connection, current)), []);
  const selectedNode = useMemo(() => nodes.find(node => node.id === selected), [nodes, selected]);
  return <div className="grid min-h-[680px] grid-cols-[1fr_290px] border border-slate-200 bg-white"><section className="min-w-0"><div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2">{palette.map(item => <Button variant="ghost" size="sm" key={item.type} onClick={() => addNode(item.type)}><item.icon size={14} />{item.label}</Button>)}</div><div className="h-[620px]"><ReactFlow nodes={nodes} edges={edges} onNodesChange={changes => setNodes(current => current.map(node => { const move = changes.find(change => change.type === "position" && "id" in change && change.id === node.id); return move && "position" in move && move.position ? { ...node, position: move.position } : node; }))} onConnect={onConnect} onNodeClick={(_, node) => setSelected(node.id)} fitView><Background gap={18} /><MiniMap /><Controls /></ReactFlow></div></section><aside className="border-l border-slate-200 p-5"><p className="text-xs font-bold tracking-widest text-blue-600">NODE INSPECTOR</p><h2 className="mt-1 font-semibold">节点配置</h2>{selectedNode ? <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm"><strong>{String(selectedNode.data.label)}</strong><p className="mt-2 text-xs leading-5 text-slate-500">选择节点后可在此配置名称、变量映射、LLM 参数、条件表达式或 HTTP 请求信息。</p></div> : <p className="mt-5 text-sm leading-6 text-slate-500">从画布选择节点以查看配置。使用顶部节点库添加开始、结束、LLM、条件、HTTP 或数据转换节点。</p>}</aside></div>;
}
