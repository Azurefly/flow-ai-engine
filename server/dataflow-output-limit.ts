import { maxDataflowDatasetRows } from "./dataflow-dataset-rows";

/** Preserve the existing limit behavior while treating an empty optional field as unset. */
export function limitDataflowOutputRows<T>(rows: T[], value: unknown): T[] {
  const empty = value == null || (typeof value === "string" && !value.trim());
  const limit = empty ? rows.length : Number(value);
  const count = Number.isFinite(limit) ? Math.max(0, limit) : rows.length;
  return rows.slice(0, Math.min(count, maxDataflowDatasetRows));
}
