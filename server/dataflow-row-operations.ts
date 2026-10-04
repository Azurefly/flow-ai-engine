import { readAggregateConfig } from "../shared/dataflow-aggregate-config";
import { readDeduplicateKeys } from "../shared/dataflow-deduplicate-config";
type Row = Record<string, unknown>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalValue(item)])
    );
  return value;
}

export function distinctDataflowRows(rows: Row[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = JSON.stringify(canonicalValue(row));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function deduplicateDataflowRows(
  rows: Row[],
  config: Record<string, unknown>
) {
  const keys = readDeduplicateKeys(config);
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const values = keys.map(field => {
      if (!Object.prototype.hasOwnProperty.call(row, field))
        throw new Error(`去重第 ${index + 1} 行缺少业务键字段 ${field}。`);
      return row[field];
    });
    const key = JSON.stringify(canonicalValue(values));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function aggregateDataflowRows(
  rows: Row[],
  config: Record<string, unknown>
) {
  const { groupBy, metrics } = readAggregateConfig(config);
  const groups = new Map<string, Row[]>();
  if (!groupBy.length) groups.set("[]", []);
  for (const row of rows) {
    const key = JSON.stringify(
      canonicalValue(groupBy.map(field => row[field] ?? null))
    );
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return Array.from(groups.values()).map(bucket => {
    const out: Row = Object.fromEntries(
      groupBy.map(field => [field, bucket[0]?.[field] ?? null])
    );
    for (const metric of metrics) {
      const present = bucket
        .map(row => row[metric.field])
        .filter(value => value !== null && value !== undefined);
      if (metric.operation === "count") {
        out[metric.name] = metric.field ? present.length : bucket.length;
        continue;
      }
      const values = present.map(value => {
        if (
          typeof value !== "number" &&
          (typeof value !== "string" || !value.trim())
        )
          throw new Error(
            `聚合指标 ${metric.name} 的字段 ${metric.field} 包含非数值。`
          );
        const number = Number(value);
        if (!Number.isFinite(number))
          throw new Error(
            `聚合指标 ${metric.name} 的字段 ${metric.field} 包含非数值。`
          );
        return number;
      });
      if (!values.length) {
        out[metric.name] = null;
        continue;
      }
      const result =
        metric.operation === "min"
          ? Math.min(...values)
          : metric.operation === "max"
            ? Math.max(...values)
            : values.reduce((sum, value) => sum + value, 0) /
              (metric.operation === "avg" ? values.length : 1);
      if (!Number.isFinite(result))
        throw new Error(`聚合指标 ${metric.name} 的结果超出数值范围。`);
      out[metric.name] = result;
    }
    return out;
  });
}
