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
      const configured = node.config.fields;
      return Array.isArray(configured) && configured.length
        ? configured.filter(
            (field): field is string => typeof field === "string"
          )
        : (assets.find(asset => asset.value === node.config.assetId)?.fields ??
            []);
    }
    const upstream = edges.filter(edge => edge.target === id);
    if (upstream.length !== 1) return [];
    const fields = read(upstream[0].source, next);
    if (!fields.length) return [];
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
