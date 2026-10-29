import { readDataflowSortFields } from "./dataflow-sort-config";

export function validateDataflowFields(
  kind: "project" | "derive" | "sort",
  fields: unknown
) {
  if (kind === "sort") {
    readDataflowSortFields(fields);
    return;
  }
  if (!Array.isArray(fields) || !fields.length)
    throw new Error("至少配置一个数据字段。");
  const outputs = new Set<string>();
  for (const field of fields) {
    if (!field || typeof field !== "object" || Array.isArray(field))
      throw new Error("数据字段配置必须是对象。");
    const item = field as Record<string, unknown>;
    const keys =
      kind === "project" ? ["source", "target"] : ["name", "expression"];
    if (
      keys.some(
        key => typeof item[key] !== "string" || !String(item[key]).trim()
      )
    )
      throw new Error(
        kind === "project"
          ? "投影需填写输入和输出字段。"
          : "派生需填写字段名称和表达式。"
      );
    const name = String(item[kind === "project" ? "target" : "name"]).trim();
    if (outputs.has(name)) throw new Error("输出字段名称不能重复。");
    outputs.add(name);
  }
}
