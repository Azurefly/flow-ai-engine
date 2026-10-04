import { runDetailRefreshInterval } from "./run-detail-refresh";
export function runMonitorRefreshInterval(input: {
  enabled: boolean;
  executingRuns?: number;
  waitingRuns?: number;
  selectedStatus?: unknown;
  queryFailed?: boolean;
}): number | false {
  if (!input.enabled || input.queryFailed) return false;
  const selectedInterval = runDetailRefreshInterval(input.selectedStatus);
  if ((input.executingRuns ?? 0) > 0 || selectedInterval === 2_000)
    return 5_000;
  if ((input.waitingRuns ?? 0) > 0 || selectedInterval === 15_000)
    return 15_000;
  return input.executingRuns === undefined || input.waitingRuns === undefined
    ? 15_000
    : 60_000;
}
