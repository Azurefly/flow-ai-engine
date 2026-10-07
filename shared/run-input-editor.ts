export type RunInputKind = "auto" | "text" | "number" | "boolean" | "json";
export type RunInputRow = { key: string; value: string; kind?: RunInputKind };
const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
function assertSafeJson(value: unknown): void {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    throw new Error("数值超出安全范围，请将业务编号改为文本。");
  if (Array.isArray(value)) value.forEach(assertSafeJson);
  else if (value && typeof value === "object")
    Object.values(value).forEach(assertSafeJson);
}
function parseValue(row: RunInputRow): unknown {
  const raw = row.value.trim();
  switch (row.kind ?? "auto") {
    case "text":
      return row.value;
    case "number": {
      if (!numberPattern.test(raw))
        throw new Error("请填写有效数值；含前导零的业务编号请选择文本。");
      const value = Number(raw);
      assertSafeJson(value);
      return value;
    }
    case "boolean":
      if (!["true", "false"].includes(raw))
        throw new Error("布尔值只能填写 true 或 false。");
      return raw === "true";
    case "json": {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error("JSON 格式无效，请检查括号和引号。");
      }
      assertSafeJson(value);
      return value;
    }
    default:
      if (raw === "true" || raw === "false") return raw === "true";
      if (raw === "null") return null;
      if (raw.startsWith("{") || raw.startsWith("["))
        return parseValue({ ...row, kind: "json" });
      if (numberPattern.test(raw)) {
        const value = Number(raw);
        if (
          Number.isFinite(value) &&
          (!Number.isInteger(value) || Number.isSafeInteger(value))
        )
          return value;
      }
      return row.value;
  }
}
export function readRunInputRows(rows: RunInputRow[]) {
  const input: Record<string, unknown> = {};
  const errors: string[] = [];
  const names = new Set<string>();
  rows.forEach((row, index) => {
    const key = row.key.trim();
    if (!key) {
      if (row.value.trim()) errors.push(`第 ${index + 1} 行请填写字段名。`);
      return;
    }
    if (names.has(key)) {
      errors.push(`第 ${index + 1} 行字段名重复：${key}`);
      return;
    }
    names.add(key);
    try {
      Object.defineProperty(input, key, {
        value: parseValue(row),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } catch (error) {
      errors.push(
        `字段 ${key}：${error instanceof Error ? error.message : "值无效"}`
      );
    }
  });
  return { input, errors };
}
export function runInputRowsFromValue(
  input: Record<string, unknown>
): RunInputRow[] {
  return Object.entries(input).map(([key, value]) => ({
    key,
    kind:
      typeof value === "string"
        ? "text"
        : typeof value === "number"
          ? "number"
          : typeof value === "boolean"
            ? "boolean"
            : "json",
    value:
      typeof value === "string" ? value : (JSON.stringify(value) ?? "null"),
  }));
}
