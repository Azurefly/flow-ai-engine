export interface WorkbenchListStatusInput {
  searchPending: boolean;
  isFetching: boolean;
  rowCount: number;
  pageNumber: number;
  hasNextPage: boolean;
}

export interface WorkbenchStatusRow {
  displayStatus?: unknown;
  status?: unknown;
  stateName?: unknown;
}

export const WORKBENCH_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "待处理",
  claimed: "处理中",
  completed: "已办",
  queued: "排队中",
  running: "运行中",
  waiting: "等待中",
  blocked: "已阻塞",
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
  terminated: "已终止",
};

export function getWorkbenchStatusOptions(
  rows: readonly WorkbenchStatusRow[],
  selectedStatus: string,
  includeBusinessStatus: boolean
) {
  const options = new Set<string>();
  for (const row of rows) {
    const values = includeBusinessStatus
      ? [row.status, row.stateName]
      : [row.displayStatus ?? row.status];
    for (const value of values) {
      if (typeof value === "string" && value.trim()) options.add(value.trim());
    }
  }
  if (selectedStatus !== "all") options.add(selectedStatus);
  return Array.from(options).sort();
}

export function getWorkbenchListStatusMessage({
  searchPending,
  isFetching,
  rowCount,
  pageNumber,
  hasNextPage,
}: WorkbenchListStatusInput) {
  const count = normalizeCount(rowCount);

  if (searchPending) {
    return count
      ? `正在筛选，暂显示上次读取的 ${count} 条记录`
      : "正在筛选符合条件的数据…";
  }

  if (isFetching) {
    return count
      ? `正在更新本页，暂显示上次读取的 ${count} 条记录`
      : "正在读取符合条件的数据…";
  }

  const page = Math.max(1, normalizeCount(pageNumber));
  return `第 ${page} 页 · 本页已载入 ${count} 条 · ${hasNextPage ? "可继续扫描授权范围" : "已到末页"}`;
}

function normalizeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
