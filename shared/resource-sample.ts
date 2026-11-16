import { readRunInputRows, type RunInputKind } from "./run-input-editor";

/** Parse sample fields using their declared schema, preserving textual identifiers. */
export function readResourceSample(
  schema: Array<{ name: string; type: string }>,
  rows: Array<{ key: string; value: string }>
) {
  const types = new Map(
    schema.map(field => [field.name.trim(), field.type.trim().toLowerCase()])
  );
  const parsed = readRunInputRows(
    rows.map(row => {
      const type = types.get(row.key.trim());
      const kind: RunInputKind =
        type === "number" || type === "integer"
          ? "number"
          : type === "boolean"
            ? "boolean"
            : ["json", "object", "array"].includes(type ?? "")
              ? "json"
              : "text";
      return { ...row, kind };
    })
  );
  for (const [key, value] of Object.entries(parsed.input)) {
    const type = types.get(key);
    if (type === "integer" && !Number.isInteger(value))
      parsed.errors.push(`字段 ${key}：请填写整数。`);
    if (type === "array" && !Array.isArray(value))
      parsed.errors.push(`字段 ${key}：请填写 JSON 数组。`);
    if (
      type === "object" &&
      (!value || typeof value !== "object" || Array.isArray(value))
    )
      parsed.errors.push(`字段 ${key}：请填写 JSON 对象。`);
  }
  if (parsed.errors.length) throw new Error(parsed.errors.join("\n"));
  return Object.keys(parsed.input).length ? [parsed.input] : [];
}
