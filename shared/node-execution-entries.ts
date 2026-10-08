const statusLabels: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  waiting: "等待中",
  success: "成功",
  failed: "失败",
  skipped: "已跳过",
};
type NodeExecutionRecord = {
  nodeId?: unknown;
  sequenceNo?: unknown;
  status?: unknown;
};

/** Keep repeated records separate; repeats do not necessarily mean retries. */
export function nodeExecutionEntries<T extends NodeExecutionRecord>(
  nodes: readonly T[] = []
) {
  const totals = new Map<string, number>();
  const occurrences = new Map<string, number>();
  const keyOf = (node: T) =>
    typeof node.nodeId === "string" && node.nodeId.length ? node.nodeId : null;
  for (const node of nodes) {
    const key = keyOf(node);
    if (key !== null) totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return nodes.map((node, index) => {
    const key = keyOf(node);
    const occurrence = key === null ? 1 : (occurrences.get(key) ?? 0) + 1;
    if (key !== null) occurrences.set(key, occurrence);
    const sequence =
      typeof node.sequenceNo === "number" &&
      Number.isSafeInteger(node.sequenceNo) &&
      node.sequenceNo > 0
        ? node.sequenceNo
        : null;
    const status = typeof node.status === "string" ? node.status : "";
    return {
      node,
      occurrence,
      totalOccurrences: key === null ? 1 : totals.get(key)!,
      orderLabel:
        sequence === null ? `记录 #${index + 1}` : `执行 #${sequence}`,
      statusLabel: Object.hasOwn(statusLabels, status)
        ? statusLabels[status]
        : `未知状态（${status || "空"}）`,
    };
  });
}
