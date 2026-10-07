export function checkDataflowQuality(
  rows: Record<string, unknown>[],
  minRowsInput: unknown,
  maxNullRateInput: unknown
) {
  const readNumber = (value: unknown) =>
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")
      ? Number(value)
      : NaN;
  const minRows = readNumber(minRowsInput);
  const maxNullRate = readNumber(maxNullRateInput);
  if (!Number.isSafeInteger(minRows) || minRows < 0)
    throw new Error("质量门配置无效：最少行数必须为非负安全整数。");
  if (!Number.isFinite(maxNullRate) || maxNullRate < 0 || maxNullRate > 1)
    throw new Error("质量门配置无效：最大空值率必须为 0 至 1 的有限数值。");
  const fields = new Set<string>();
  rows.forEach(row => Object.keys(row).forEach(field => fields.add(field)));
  if (rows.length && !fields.size)
    throw new Error("质量门失败：数据行没有可用字段。");
  const columns = Array.from(fields);
  const totalCells = rows.length * columns.length;
  let nullCells = 0;
  for (const row of rows)
    for (const field of columns) {
      if (row[field] === null || row[field] === undefined || row[field] === "")
        nullCells++;
    }
  const nullRate = totalCells ? nullCells / totalCells : 0;
  if (rows.length < minRows || nullRate > maxNullRate)
    throw new Error(
      `质量门失败：行数 ${rows.length}/${minRows}，空值率 ${nullRate.toFixed(4)}/${maxNullRate}。`
    );
  return { passed: true, rowCount: rows.length, nullRate };
}
