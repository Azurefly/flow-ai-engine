import { formatRunStatus } from "@shared/run-status-summary";

export function RunStatusBadge({ status }: { status: string }) {
  return <span className="run-status-badge" data-status={status}>{formatRunStatus(status)}</span>;
}
