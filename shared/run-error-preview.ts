/** Error payloads are not workflow input/context snapshots. */
export function runErrorPreview(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      /* plain error text */
    }
  }
  if (typeof parsed === "string")
    return { message: parsed, details: null, stack: null };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { message: null, details: parsed, stack: null };
  const record = parsed as Record<string, unknown>;
  const message =
    typeof record.message === "string" && record.message.trim()
      ? record.message
      : null;
  const stack =
    typeof record.stack === "string" && record.stack.trim()
      ? record.stack
      : null;
  const fields = Object.entries(record).filter(
    ([key]) =>
      !(key === "message" && message !== null) &&
      !(key === "stack" && stack !== null)
  );
  return {
    message,
    details: fields.length ? Object.fromEntries(fields) : null,
    stack,
  };
}
