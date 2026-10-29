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
  queryErrorCode?: string | null;
  detail?: { id?: string; workflowId?: string } | null;
}) {
  if (input.queriedRunId !== input.requestedRunId) return false;
  // Permission changes and transient failures must not discard the selected
  // instance or its in-memory operation draft. Only a definitive missing run
  // makes the link invalid; other errors stay on the retryable detail view.
  if (input.queryFailed) return input.queryErrorCode === "NOT_FOUND";
  return (
    input.detail?.id === input.requestedRunId &&
    input.detail.workflowId !== input.workflowId
  );
}
