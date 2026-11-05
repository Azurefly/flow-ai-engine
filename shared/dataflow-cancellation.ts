/** Unknown mutation failures must be resolved by reading this instance, never resubmitting a run. */
export function cancellationNeedsReadback(code: unknown) {
  return ![
    "BAD_REQUEST",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
  ].includes(String(code));
}

export function cancellationReadback(
  run: { id: string; status: string; canCancel?: boolean } | null,
  runId: string
) {
  if (!run || run.id !== runId) return "unavailable";
  if (run.status === "cancelled") return "cancelled";
  if (["success", "failed"].includes(run.status)) return "finished";
  return run.canCancel ? "retry" : "forbidden";
}
