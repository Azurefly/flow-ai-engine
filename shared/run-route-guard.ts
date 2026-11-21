import type { ConsoleRoute } from "./console-route";

/** The monitor route owns its run identity, including an explicit empty selection. */
export function resolveMonitorRunId(
  route: ConsoleRoute,
  selectedRunId: string | null
) {
  return route.section === "runs" && route.view === "monitor"
    ? route.runId ?? null
    : selectedRunId;
}

export function shouldResetRunRoute(input: {
  requestedRunId: string;
  queriedRunId: string;
  workflowId: string;
  queryFailed: boolean;
  detail?: { id?: string; workflowId?: string } | null;
}) {
  // The detail pane owns read errors, including missing or inaccessible runs.
  if (input.queryFailed || input.queriedRunId !== input.requestedRunId) return false;
  return (
    input.detail?.id === input.requestedRunId &&
    input.detail.workflowId !== input.workflowId
  );
}
