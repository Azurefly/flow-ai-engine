export type RunRecord = Record<string, any>;
export type RunGraphNode = RunRecord & {
  id: string;
  name: string;
  records: RunRecord[];
  status: string;
  activeCount: number;
  position: { x: number; y: number };
  layout: { x: number; y: number };
};
export const runNodeLabels: Record<string, string> = {
  idle: "未执行",
  running: "运行中",
  waiting: "等待中",
  success: "已完成",
  failed: "失败",
  skipped: "已跳过",
  stopped: "已停止",
};
export function parseRunValue(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
function ordered(records: RunRecord[]) {
  return [...records].sort(
    (a, b) =>
      (Number(a.sequenceNo) || 0) - (Number(b.sequenceNo) || 0) ||
      new Date(a.startedAt ?? a.createdAt ?? 0).getTime() -
        new Date(b.startedAt ?? b.createdAt ?? 0).getTime()
  );
}
export function projectRunGraph(run: RunRecord) {
  const snapshot = parseRunValue(run.definitionSnapshotJson);
  const definition = snapshot?.definition ?? snapshot;
  const rawNodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const executions = new Map<string, RunRecord[]>();
  for (const item of run.nodeRuns ?? []) {
    const id = String(item.nodeId ?? "");
    if (!id) continue;
    const rows = executions.get(id) ?? [];
    rows.push(item);
    executions.set(id, rows);
  }
  const seen = new Set<string>();
  const sourceNodes: RunRecord[] = [];
  for (const item of rawNodes) {
    if (!item || !item.id || seen.has(String(item.id))) continue;
    seen.add(String(item.id));
    sourceNodes.push(item);
  }
  for (const [id, records] of Array.from(executions.entries()))
    if (!seen.has(id)) {
      seen.add(id);
      sourceNodes.push({
        id,
        name: records[0].nodeName ?? id,
        type: records[0].nodeType,
        fromLog: true,
      });
    }
  const ended = ["success", "failed", "cancelled", "terminated"].includes(
    run.status
  );
  const nodes: RunGraphNode[] = sourceNodes.map(item => {
    const records = ordered(executions.get(String(item.id)) ?? []);
    const last = records.at(-1);
    const active = records.filter(x =>
      ["running", "waiting", "pending"].includes(x.status)
    );
    const state = active.length
      ? ended
        ? "stopped"
        : active.some(x => x.status === "running")
          ? "running"
          : "waiting"
      : (last?.status ?? "idle");
    return {
      ...item,
      id: String(item.id),
      name: String(item.name ?? last?.nodeName ?? item.id),
      records,
      status: Object.hasOwn(runNodeLabels, state) ? state : "idle",
      activeCount: ended ? 0 : active.length,
      layout: { x: 0, y: 0 },
      position: {
        x: Number(item.position?.x) || 0,
        y: Number(item.position?.y) || 0,
      },
    };
  });
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edgeIds = new Set<string>();
  const edges: RunRecord[] = [];
  for (const [index, edge] of (Array.isArray(definition?.edges)
    ? definition.edges
    : []
  ).entries()) {
    const source = String(edge?.sourceNodeId ?? edge?.source ?? ""),
      target = String(edge?.targetNodeId ?? edge?.target ?? "");
    const id = String(edge?.id ?? "edge-" + index);
    if (!nodeMap.has(source) || !nodeMap.has(target) || edgeIds.has(id))
      continue;
    edgeIds.add(id);
    const node = nodeMap.get(source)!;
    const handle = String(edge.sourceHandle ?? "default");
    const configured = Array.isArray(node.config?.outcomes)
      ? node.config.outcomes.find(
          (o: RunRecord) => String(o.sourceHandle ?? o.code) === handle
        )
      : undefined;
    const confirmations = node.records.filter((record: RunRecord) => {
      if (record.status !== "success") return false;
      const output = parseRunValue(record.outputJson);
      if (!output || typeof output !== "object") return false;
      if (node.type === "operate" && node.config?.outcomeMode === "explicit")
        return (
          Array.isArray(node.config.outcomes) ? node.config.outcomes : []
        ).some(
          (o: RunRecord) =>
            o.code === output.outcome &&
            String(o.sourceHandle ?? o.code) === handle
        );
      if (node.type === "condition" && typeof output.matched === "boolean")
        return (
          handle ===
          String(
            output.matched
              ? (node.config?.trueHandle ?? "true")
              : (node.config?.falseHandle ?? "false")
          )
        );
      if (node.type === "router")
        return (
          Array.isArray(output.selectedBranches) ? output.selectedBranches : []
        ).some(
          (b: RunRecord) =>
            String(b.handle) === handle &&
            (!b.targetNodeId || String(b.targetNodeId) === target)
        );
      return false;
    }).length;
    edges.push({
      ...edge,
      id,
      source,
      target,
      label: configured?.label ?? (handle === "default" ? "" : handle),
      confirmed: confirmations,
      returning: false,
    });
  }
  // Remove DFS back edges for ranking only; retain every edge in the displayed graph.
  const outgoing = new Map<string, RunRecord[]>();
  for (const n of nodes) outgoing.set(n.id, []);
  for (const e of edges) outgoing.get(e.source)!.push(e);
  const colors = new Map<string, number>();
  for (const node of nodes) {
    if (colors.get(node.id)) continue;
    const stack = [{ id: node.id, index: 0 }];
    colors.set(node.id, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = outgoing.get(frame.id) ?? [];
      if (frame.index >= next.length) {
        colors.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edge = next[frame.index++];
      if (colors.get(edge.target) === 1) edge.returning = true;
      else if (!colors.get(edge.target)) {
        colors.set(edge.target, 1);
        stack.push({ id: edge.target, index: 0 });
      }
    }
  }
  const indegree = new Map(nodes.map(n => [n.id, 0])),
    rank = new Map(nodes.map(n => [n.id, 0]));
  for (const e of edges)
    if (!e.returning) indegree.set(e.target, indegree.get(e.target)! + 1);
  const queue = nodes.filter(n => !indegree.get(n.id)).map(n => n.id);
  for (let i = 0; i < queue.length; i++) {
    for (const e of outgoing.get(queue[i]) ?? []) {
      if (e.returning) continue;
      rank.set(
        e.target,
        Math.max(rank.get(e.target)!, rank.get(e.source)! + 1)
      );
      indegree.set(e.target, indegree.get(e.target)! - 1);
      if (!indegree.get(e.target)) queue.push(e.target);
    }
  }
  const rows = new Map<number, number>();
  for (const n of nodes) {
    const col = rank.get(n.id) ?? 0;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    n.layout = { x: col * 310, y: row * 150 };
  }
  return {
    nodes,
    edges,
    hasSnapshot: rawNodes.length > 0,
    hasOriginalLayout:
      sourceNodes.length > 0 &&
      sourceNodes.every(
        n =>
          !n.fromLog &&
          Number.isFinite(n.position?.x) &&
          Number.isFinite(n.position?.y)
      ),
    warning:
      rawNodes.length === 0
        ? "缺少流程快照，仅展示执行节点，无法还原连线。"
        : rawNodes.length !== sourceNodes.filter(n => !n.fromLog).length ||
            (Array.isArray(definition?.edges) &&
              definition.edges.length !== edges.length)
          ? "快照不完整或重复，部分连线无法还原。"
          : sourceNodes.some(n => n.fromLog)
            ? "快照外执行节点已单独展示。"
            : "",
  };
}
