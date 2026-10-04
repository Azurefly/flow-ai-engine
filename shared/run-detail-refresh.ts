/** Poll only visible queries for active instances; completed history stays quiet. */
export function runDetailRefreshInterval(
  status: unknown,
  hasError = false
): number | false {
  if (hasError) return false;
  if (status === "queued" || status === "running") return 2_000;
  if (status === "waiting" || status === "blocked") return 15_000;
  return false;
}
