import { maxDataflowDatasetRows } from "./dataflow-dataset-rows";

type Row = Record<string, unknown>;

export function joinDataflowRows(
  left: Row[],
  right: Row[],
  config: Record<string, unknown>,
  limit = maxDataflowDatasetRows
) {
  const leftKeys = (config.leftKeys as string[]) ?? [];
  const rightKeys = (config.rightKeys as string[]) ?? [];
  const prefix = String(config.rightPrefix ?? "right_");
  const leftFields = new Set(left.flatMap(row => Object.keys(row)));
  const rightFields = new Set(right.flatMap(row => Object.keys(row)));
  const names = new Map<string, string>();
  const occupied = new Set(leftFields);
  for (const field of Array.from(rightFields)) {
    const target = leftFields.has(field) ? `${prefix}${field}` : field;
    if (occupied.has(target))
      throw new Error(
        `关联输出字段 ${target} 重名，请调整右侧同名字段前缀或先投影重命名。`
      );
    occupied.add(target);
    names.set(field, target);
  }
  const keyOf = (row: Row, keys: string[]) => {
    const values = keys.map(field => row[field]);
    return values.some(value => value === null || value === undefined)
      ? undefined
      : JSON.stringify(values);
  };
  const index = new Map<string, Row[]>();
  for (const row of right) {
    const key = keyOf(row, rightKeys);
    if (key === undefined) continue;
    const bucket = index.get(key) ?? [];
    bucket.push(row);
    index.set(key, bucket);
  }
  const rows: Row[] = [];
  const append = (row: Row, match?: Row) => {
    if (rows.length >= limit)
      throw new Error(
        `关联结果超过 ${limit} 行执行上限，请先筛选；不会截断后继续运行。`
      );
    rows.push({
      ...row,
      ...Object.fromEntries(
        Array.from(names, ([source, target]) => [
          target,
          match?.[source] ?? null,
        ])
      ),
    });
  };
  for (const row of left) {
    const key = keyOf(row, leftKeys);
    const matches = key === undefined ? [] : (index.get(key) ?? []);
    if (!matches.length && config.kind === "left") append(row);
    for (const match of matches) append(row, match);
  }
  return rows;
}
