/** Validation always blocks bad submissions; inline messages follow interaction. */
export function visibleTaskFormErrors(
  errors: Record<string, string>,
  touched: ReadonlySet<string>,
  fields: ReadonlyArray<{ key: string; readOnly: boolean }>
): Record<string, string> {
  const readOnly = new Set(
    fields.filter(field => field.readOnly).map(field => field.key)
  );
  return Object.fromEntries(
    Object.entries(errors).filter(
      ([key]) => touched.has(key) || readOnly.has(key)
    )
  );
}
