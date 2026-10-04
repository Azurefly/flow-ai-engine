export function shouldResetRunRoute(input: {
  requestedRunId: string;
  queriedRunId: string;
  workflowId: string;
  queryFailed: boolean;
  detail?: { id?: string; workflowId?: string } | null;
}) {
  if (input.queriedRunId !== input.requestedRunId) return false;
  if (input.queryFailed) return true;
  return (
    input.detail?.id === input.requestedRunId &&
    input.detail.workflowId !== input.workflowId
  );
}
