import React from "react";
import {
  approvalParticipantStatus,
  type RunApprovalGroup,
} from "@shared/run-approval-progress";
export function RunApprovalProgress({ group }: { group: RunApprovalGroup }) {
  return (
    <section
      aria-label="审批进度"
      className="rounded-lg border border-border bg-background p-3"
    >
      <h4 className="text-sm font-semibold">审批进度</h4>
      <p className="mt-1 text-sm text-muted-foreground">
        已通过 {group.approved} 人 · 需通过 {group.required} 人 · 共{" "}
        {group.total} 人 · 已拒绝 {group.rejected} 人
      </p>
      <ol
        className="mt-3 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2"
        aria-label="审批人员状态"
      >
        {group.participants.map((participant, index) => (
          <li
            key={index}
            className="flex min-w-0 items-start justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm"
          >
            <span className="min-w-0 break-words">
              {group.signMode === "sequentialSignFor" ? `${index + 1}. ` : ""}
              {participant.name}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {approvalParticipantStatus(
                participant.status,
                participant.decision
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
