export function formatRunDuration(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value} ms`
    : "—";
}
