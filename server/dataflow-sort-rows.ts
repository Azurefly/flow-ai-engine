import { readDataflowSortFields } from "../shared/dataflow-sort-config";
import { canonicalValue } from "./dataflow-key-value";

// 明确类型顺序，避免字符串字典序和隐式数字转换混用形成比较环。
function sortValue(value: unknown, field: string) {
  if (value == null) return { rank: 0, value: "" };
  if (typeof value === "number" && Number.isFinite(value))
    return { rank: 1, value };
  if (typeof value === "string") return { rank: 2, value };
  if (typeof value === "boolean") return { rank: 3, value };
  if (typeof value === "object")
    return {
      rank: Array.isArray(value) ? 4 : 5,
      value: JSON.stringify(canonicalValue(value)),
    };
  throw new Error(
    `排序字段 ${field} 包含不支持的值，请先转换为有效的JSON数据。`
  );
}

/** Stable typed ordering; source rows and configuration remain untouched. */
export function sortDataflowRows<T extends Record<string, unknown>>(
  input: T[],
  config: Record<string, unknown>
): T[] {
  const fields = readDataflowSortFields(config.fields);
  // 每行预计算一次比较键，也使单行输入中的非法值能够被明确拒绝。
  return input
    .map(row => ({
      row,
      keys: fields.map(item => sortValue(row[item.field], item.field)),
    }))
    .sort((left, right) => {
      for (let index = 0; index < fields.length; index++) {
        const a = left.keys[index],
          b = right.keys[index];
        const order =
          a.rank - b.rank ||
          (a.value === b.value ? 0 : a.value < b.value ? -1 : 1);
        if (order) return order * (fields[index].direction === "desc" ? -1 : 1);
      }
      return 0;
    })
    .map(item => item.row);
}
