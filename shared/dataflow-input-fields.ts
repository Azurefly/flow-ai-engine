import { readAggregateConfig } from "./dataflow-aggregate-config";
import { readDataflowFieldNames } from "./dataflow-field-list";

export function usesDataflowInputFieldSuggestions(kind: string, key: string) {
  return (
    (kind === "udf" && key === "inputField") ||
    (kind === "filter" && key === "filterField")
  );
}
type Node = { id: string; kind: string; config: Record<string, unknown> };
export function dataflowInputFields(
  nodeId: string,
  nodes: Node[],
  edges: { source: string; target: string }[],
  assets: { value: string; fields: string[] }[]
) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const read = (id: string, seen: Set<string>): string[] => {
    if (seen.has(id)) return [];
    const node = byId.get(id);
    if (!node) return [];
    const next = new Set(seen).add(id);
    if (["source", "table"].includes(node.kind)) {
      // UX 修复：连接器实际读取 columns，不能推荐已排除的资源列。
      try {
        const columns = readDataflowFieldNames(node.config.columns, "读取字段");
        return columns.length
          ? columns
          : (assets.find(asset => asset.value === node.config.assetId)?.fields ??
              []);
      } catch {
        return [];
      }
    }
    const upstream = edges.filter(edge => edge.target === id);
    if (node.kind === "join") {
      const leftId = String(node.config.leftInputNodeId ?? "").trim();
      const rightId = String(node.config.rightInputNodeId ?? "").trim();
      if (
        upstream.length !== 2 ||
        !leftId ||
        leftId === rightId ||
        !upstream.some(edge => edge.source === leftId) ||
        !upstream.some(edge => edge.source === rightId)
      )
        return [];
      const left = read(leftId, next),
        right = read(rightId, next);
      if (!left.length || !right.length) return [];
      const occupied = new Set(left);
      const output = [...left];
      for (const name of right) {
        const target = left.includes(name)
          ? `${String(node.config.rightPrefix ?? "right_")}${name}`
          : name;
        if (occupied.has(target)) return [];
        occupied.add(target);
        output.push(target);
      }
      return output;
    }
    if (upstream.length !== 1) return [];
    // UX 优化：聚合输出由配置确定，不沿用原始明细列或依赖样本元数据。
    if (node.kind === "aggregate") {
      try {
        const { groupBy, metrics } = readAggregateConfig(node.config);
        return [...groupBy, ...metrics.map(metric => metric.name)];
      } catch {
        return [];
      }
    }
    const fields = read(upstream[0].source, next);
    if (!fields.length) return [];
    if (["map", "project"].includes(node.kind)) {
      const mappings = node.config.fields;
      if (Array.isArray(mappings) && mappings.length)
        return mappings.flatMap(item =>
          item &&
          typeof item === "object" &&
          typeof (item.target ?? item.source) === "string"
            ? [item.target ?? item.source]
            : []
        );
      return Array.isArray(node.config.columns) && node.config.columns.length
        ? node.config.columns.filter(
            (name): name is string => typeof name === "string"
          )
        : fields;
    }
    if (node.kind === "derive") {
      const added = Array.isArray(node.config.fields)
        ? node.config.fields.flatMap(item =>
            item &&
            typeof item.name === "string" &&
            item.name.trim() &&
            String(item.expression ?? "").trim()
              ? [item.name.trim()]
              : []
          )
        : [];
      return Array.from(new Set([...fields, ...added]));
    }
    if (node.kind === "udf")
      return Array.from(
        new Set([
          ...fields,
          ...(typeof node.config.outputField === "string" &&
          node.config.outputField
            ? [node.config.outputField]
            : []),
        ])
      );
    if (
      [
        "filter",
        "sort",
        "limit",
        "distinct",
        "deduplicate",
        "quality_gate",
      ].includes(node.kind)
    )
      return fields;
    return [];
  };
  const upstream = edges.filter(edge => edge.target === nodeId);
  return upstream.length === 1
    ? read(upstream[0].source, new Set([nodeId])).slice(0, 100)
    : [];
}
export function dataflowSchemaFields(schema: unknown): string[] {
  if (!Array.isArray(schema)) return [];
  return Array.from(
    new Set(
      schema.flatMap(field =>
        field && typeof field.name === "string" && field.name
          ? [field.name]
          : []
      )
    )
  ).slice(0, 100);
}
