const fields: Record<string, string[]> = {
  source: ["columns"],
  data_source: ["columns"],
  table: ["columns"],
  map: ["columns"],
  transform: ["columns"],
  join: ["leftKeys", "rightKeys"],
  aggregate: ["groupBy"],
  deduplicate: ["keys"],
};
export function isDataflowFieldList(
  nodeKind: string | undefined,
  fieldKey: string
) {
  return Boolean(nodeKind && fields[nodeKind]?.includes(fieldKey));
}
export function fieldListIssue(value: unknown): string | null {
  if (!Array.isArray(value)) return "配置应为字段列表，请先修正原配置。";
  if (value.some(item => typeof item !== "string"))
    return "历史配置包含非文本项，请修改或删除该项。";
  const names = value.map(item => item.trim());
  if (names.some(name => !name)) return "请填写字段名称或删除空白项。";
  if (new Set(names).size !== names.length) return "字段名称不能重复。";
  return null;
}
