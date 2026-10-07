export const dataflowResultPageSize = 10;
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
