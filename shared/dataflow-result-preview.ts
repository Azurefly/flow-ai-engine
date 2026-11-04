export const dataflowResultPageSize = 10;

/** Display only: the underlying value and row remain unchanged. */
export function dataflowResultValue(value: unknown, preview = true): string {
  if (value === null || value === undefined)
    return preview ? "—" : value === null ? "null" : "未提供";
  if (!preview && typeof value !== "object") return String(value);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, preview ? undefined : 2);
  if (!text) return String(value);
  return preview && text.length > 96
    ? `${text.slice(0, 93).replace(/[\uD800-\uDBFF]$/, "")}…`
    : text;
}

export function dataflowResultValueKind(value: unknown): string {
  if (value === null) return "空值";
  if (value === "") return "空字符串";
  if (Array.isArray(value)) return "列表";
  return ({ string: "文本", number: "数字", boolean: "布尔值", object: "对象", undefined: "缺失值" } as Record<string, string>)[typeof value] ?? "其他";
}

export function dataflowResultColumns(rows: Record<string, unknown>[]) {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return Array.from(columns);
}
export function dataflowResultPage(
  rows: Record<string, unknown>[],
  requestedPage: number
) {
  const pageCount = Math.max(
    1,
    Math.ceil(rows.length / dataflowResultPageSize)
  );
  const page = Math.min(
    Math.max(0, Math.trunc(requestedPage) || 0),
    pageCount - 1
  );
  const offset = page * dataflowResultPageSize;
  return {
    page,
    pageCount,
    offset,
    rows: rows.slice(offset, offset + dataflowResultPageSize),
  };
}

export function dataflowTerminalResults(output: unknown) {
  const terminals =
    output && typeof output === "object" && "terminals" in output
      ? (output as { terminals: unknown }).terminals
      : null;
  if (!Array.isArray(terminals)) return [];
  return terminals.flatMap((terminal, index) => {
    if (!terminal || !Array.isArray(terminal.rows)) return [];
    return [
      {
        name: String(
          terminal.outputName ||
            terminal.nodeName ||
            terminal.nodeId ||
            `结果 ${index + 1}`
        ),
        rows: terminal.rows.map(
          (row: unknown): Record<string, unknown> =>
            row && typeof row === "object" && !Array.isArray(row)
              ? (row as Record<string, unknown>)
              : { value: row }
        ),
      },
    ];
  });
}
