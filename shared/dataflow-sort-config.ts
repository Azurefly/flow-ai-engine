export type DataflowSortField = { field: string; direction: "asc" | "desc" };

/** One configuration contract for preflight and execution; never rewrites saved input. */
export function readDataflowSortFields(value: unknown): DataflowSortField[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error("至少配置一个数据字段。");
  const direction = (value: unknown) => {
    const normalized = String(value ?? "asc").toLowerCase();
    if (normalized !== "asc" && normalized !== "desc")
      throw new Error("排序方向必须为 asc 或 desc。");
    return normalized;
  };
  return value.map(item => {
    if (typeof item === "string") {
      if (!item.trim()) throw new Error("排序字段不能为空。");
      return { field: item.trim(), direction: "asc" };
    }
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("数据字段配置必须是对象。");
    if (typeof item.field !== "string" || !item.field.trim())
      throw new Error("排序需填写字段名称。");
    // UX 修复：旧 order 不能被静默忽略；两种写法冲突时要求明确选择。
    const normalized = direction(item.direction ?? item.order);
    if (
      item.direction != null &&
      item.order != null &&
      normalized !== direction(item.order)
    )
      throw new Error(
        `排序字段 ${item.field} 的 direction 与 order 不一致，请确认排序方向。`
      );
    return { field: item.field.trim(), direction: normalized };
  });
}
