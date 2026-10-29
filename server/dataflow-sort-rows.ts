import { readDataflowSortFields } from "../shared/dataflow-sort-config";

/** Preserve stable, lexicographic sorting and the source rows. */
export function sortDataflowRows<T extends Record<string, unknown>>(
  input: T[],
  config: Record<string, unknown>
): T[] {
  const fields = readDataflowSortFields(config.fields);
  return [...input].sort((left, right) => {
    for (const item of fields) {
      const a = left[item.field],
        b = right[item.field];
      // Missing and explicit null have equal ordering; secondary keys still apply.
      if (a === b || (a == null && b == null)) continue;
      const order =
        a == null ? -1 : b == null ? 1 : (a as any) < (b as any) ? -1 : 1;
      return order * (item.direction === "desc" ? -1 : 1);
    }
    return 0;
  });
}
