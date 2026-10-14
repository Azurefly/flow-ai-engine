export function readWorkflowLoopLimit(value: string): number | null {
  const count = Number(value);
  return value.trim() && Number.isInteger(count) && count >= 1 && count <= 1000
    ? count
    : null;
}

export function workflowLoopDraftError(definition: unknown): string | null {
  if (!definition || typeof definition !== "object") return null;
  const draft = definition as {
    edges?: Array<{
      id?: string;
      sourceNodeId?: string;
      targetNodeId?: string;
      loop?: { maxIterations?: unknown } | null;
    }>;
    nodes?: Array<{ id: string; name?: string }>;
  };
  if (!Array.isArray(draft.edges)) return null;
  const names = new Map(
    (Array.isArray(draft.nodes) ? draft.nodes : []).map(node => [
      node.id,
      node.name || node.id,
    ])
  );
  for (const edge of draft.edges) {
    if (!edge.loop) continue;
    const value = edge.loop.maxIterations;
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      readWorkflowLoopLimit(String(value)) === null
    ) {
      const label = `${names.get(edge.sourceNodeId ?? "") ?? "起点"} → ${names.get(edge.targetNodeId ?? "") ?? "终点"}`;
      return `连线“${label}”的返回次数必须为 1–1000 之间的整数。请修正后再保存、发布或运行。`;
    }
  }
  return null;
}
