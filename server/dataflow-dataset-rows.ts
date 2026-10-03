export const maxDataflowDatasetRows = 100_000;
export function normalizeRows(
  value: unknown,
  sampleLimit?: number
): Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray((value as Record<string, unknown> | undefined)?.rows)
      ? (value as { rows: unknown[] }).rows
      : [];
  if (sampleLimit === undefined && rows.length > maxDataflowDatasetRows)
    throw new Error(
      `数据集超过 ${maxDataflowDatasetRows} 行执行上限，请先筛选或聚合；不会截断后继续运行。`
    );
  return (sampleLimit === undefined ? rows : rows.slice(0, sampleLimit))
    .filter(row => row && typeof row === "object")
    .map(row => JSON.parse(JSON.stringify(row)));
}
