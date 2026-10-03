export function validateDataflowFields(
  kind: "project" | "derive" | "sort",
  fields: unknown
) {
  if (!Array.isArray(fields) || !fields.length)
    throw new Error("至少配置一个数据字段。");
  const outputs = new Set<string>();
  for (const field of fields) {
    if (kind === "sort" && typeof field === "string") {
      if (!field.trim()) throw new Error("排序字段不能为空。");
      continue;
    }
    if (!field || typeof field !== "object" || Array.isArray(field))
      throw new Error("数据字段配置必须是对象。");
    const item = field as Record<string, unknown>;
    const keys =
      kind === "project"
        ? ["source", "target"]
        : kind === "derive"
          ? ["name", "expression"]
          : ["field"];
    if (
      keys.some(
        key => typeof item[key] !== "string" || !String(item[key]).trim()
      )
    )
      throw new Error(
        kind === "project"
          ? "投影需填写输入和输出字段。"
          : kind === "derive"
            ? "派生需填写字段名称和表达式。"
            : "排序需填写字段名称。"
      );
    if (
      kind === "sort" &&
      !["asc", "desc"].includes(String(item.direction ?? "asc").toLowerCase())
    )
      throw new Error("排序方向必须为 asc 或 desc。");
    if (kind !== "sort") {
      const name = String(item[kind === "project" ? "target" : "name"]).trim();
      if (outputs.has(name)) throw new Error("输出字段名称不能重复。");
      outputs.add(name);
    }
  }
}
