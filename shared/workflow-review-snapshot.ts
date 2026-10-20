export type WorkflowReviewSnapshot = {
  id: string;
  name: string;
  description?: string | null;
  flowType: string;
  status: string;
  definitionVersion: number;
  auditStatus: "init" | "approved" | "rejected";
  nodeCount: number;
  edgeCount: number;
  actions: { canReview: boolean; reviewBlockedReason?: string | null };
};

/** Keep only the displayed baseline; do not copy whole definitions or execution plans. */
export function workflowReviewSnapshot(row: {
  id: string;
  name: string;
  description?: string | null;
  flowType: string;
  status: string;
  definitionVersion: number | string;
  auditStatus: WorkflowReviewSnapshot["auditStatus"];
  definition?: { nodes?: unknown[]; edges?: unknown[] };
  actions?: { canReview?: boolean; reviewBlockedReason?: string | null };
}): WorkflowReviewSnapshot {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    flowType: row.flowType,
    status: row.status,
    definitionVersion: Number(row.definitionVersion),
    auditStatus: row.auditStatus,
    nodeCount: Array.isArray(row.definition?.nodes)
      ? row.definition.nodes.length
      : 0,
    edgeCount: Array.isArray(row.definition?.edges)
      ? row.definition.edges.length
      : 0,
    actions: {
      canReview: row.actions?.canReview === true,
      reviewBlockedReason: row.actions?.reviewBlockedReason,
    },
  };
}
