export function dataflowReadLimit(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 1000
  )
    throw new Error("读取行数必须为 1 至 1000 的整数。");
  return value;
}
