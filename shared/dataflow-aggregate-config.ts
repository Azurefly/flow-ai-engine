import { readDataflowFieldNames } from "./dataflow-field-list";
export type AggregateMetric = {
  name: string;
  operation: "count" | "sum" | "min" | "max" | "avg";
  field: string;
};

export function readAggregateConfig(config: Record<string, unknown>) {
  if (
    !Array.isArray(config.groupBy) ||
    !Array.isArray(config.metrics) ||
    !config.metrics.length
  )
    throw new Error("聚合节点需配置分组字段数组和至少一个指标。");
  const groupBy = readDataflowFieldNames(config.groupBy, "聚合分组字段");
  const names = new Set(groupBy);
  const metrics = config.metrics.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("聚合指标必须是对象。");
    const item = value as Record<string, unknown>;
    const name = String(item.name ?? "").trim();
    const operation = String(item.operation ?? "count");
    const field = String(item.field ?? "").trim();
    if (!name || names.has(name))
      throw new Error("聚合指标名称不能为空，也不能与分组字段或其他指标重复。");
    if (!["count", "sum", "min", "max", "avg"].includes(operation))
      throw new Error("聚合指标运算仅支持 count、sum、min、max、avg。");
    if (operation !== "count" && !field)
      throw new Error("数值聚合指标必须选择字段。");
    names.add(name);
    return { name, operation, field } as AggregateMetric;
  });
  return { groupBy, metrics };
}
