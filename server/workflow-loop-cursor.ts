/** Counts traversals of declared loop edges within one execution branch. */
export type WorkflowLoopCursor = {
  schemaVersion: 1;
  traversals: { edgeId: string; count: number }[];
};

type LoopEdge = { id: string; loop?: { maxIterations: number } };
const validEdgeId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Validate before hashing or copying a persisted cursor. Never coerce counts. */
export function restoreWorkflowLoopCursor(value: unknown): WorkflowLoopCursor {
  const invalid = () => {
    throw new Error("循环迭代检查点无效，无法安全恢复。");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const cursor = value as WorkflowLoopCursor;
  if (cursor.schemaVersion !== 1 || !Array.isArray(cursor.traversals))
    return invalid();
  const seen = new Set<string>();
  const traversals = Array.from(cursor.traversals, entry => {
    if (
      !entry ||
      !validEdgeId(entry.edgeId) ||
      seen.has(entry.edgeId) ||
      !Number.isInteger(entry.count) ||
      entry.count < 1 ||
      entry.count > 1000
    )
      return invalid();
    seen.add(entry.edgeId);
    return { edgeId: entry.edgeId, count: entry.count };
  });
  // Canonical order must not depend on the host's locale or object insertion order.
  traversals.sort((a, b) =>
    a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0
  );
  return { schemaVersion: 1, traversals };
}

export function emptyWorkflowLoopCursor(): WorkflowLoopCursor {
  return { schemaVersion: 1, traversals: [] };
}

/** Check against the immutable definition used by this run, not the latest draft. */
export function validateWorkflowLoopCursor(value: unknown, edges: LoopEdge[]) {
  const cursor = restoreWorkflowLoopCursor(value);
  const policies = new Map<string, number>();
  for (const edge of edges.filter(edge => edge.loop)) {
    const limit = edge.loop!.maxIterations;
    if (
      !validEdgeId(edge.id) ||
      policies.has(edge.id) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new Error("循环次数策略无效，无法安全恢复。");
    policies.set(edge.id, limit);
  }
  for (const entry of cursor.traversals) {
    const limit = policies.get(entry.edgeId);
    if (limit === undefined || entry.count > limit)
      throw new Error(`循环边 ${entry.edgeId} 的迭代检查点与运行定义不一致。`);
  }
  return cursor;
}

/** A successor receives a copy. Replaying its predecessor must not mutate it. */
export function advanceWorkflowLoopCursor(value: unknown, edge: LoopEdge) {
  const cursor = restoreWorkflowLoopCursor(value);
  if (!edge.loop) return cursor;
  const limit = edge.loop.maxIterations;
  if (
    !validEdgeId(edge.id) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new Error("循环次数策略无效，不能推进流程。");
  const entry = cursor.traversals.find(item => item.edgeId === edge.id);
  const count = (entry?.count ?? 0) + 1;
  if (count > limit)
    throw new Error(`循环边 ${edge.id} 已达到 ${limit} 次上限，不能再次返回。`);
  if (entry) entry.count = count;
  else cursor.traversals.push({ edgeId: edge.id, count });
  return restoreWorkflowLoopCursor(cursor);
}

/** Sibling branches keep independent counts; a join preserves their maxima. */
export function mergeWorkflowLoopCursors(values: unknown[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const entry of restoreWorkflowLoopCursor(value).traversals)
      counts.set(entry.edgeId, Math.max(counts.get(entry.edgeId) ?? 0, entry.count));
  }
  return restoreWorkflowLoopCursor({ schemaVersion: 1, traversals: Array.from(counts, ([edgeId, count]) => ({ edgeId, count })) });
}
