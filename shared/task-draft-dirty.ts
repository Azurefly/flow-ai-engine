type Row = { key: string; value: string };
export function hasTaskDraftChanges(input: {
  rows: Row[];
  initialRows: Row[];
  outcome: string;
  initialOutcome: string;
  comment: string;
  targetUserId: string;
  reassignmentReason: string;
  removeMemberTaskId: string;
}) {
  const values = (rows: Row[]) =>
    rows
      .filter(row => row.key !== "" || row.value !== "")
      .map(row => [row.key, row.value]);
  return (
    JSON.stringify(values(input.rows)) !==
      JSON.stringify(values(input.initialRows)) ||
    input.outcome !== input.initialOutcome ||
    Boolean(
      input.comment ||
        input.targetUserId ||
        input.reassignmentReason ||
        input.removeMemberTaskId
    )
  );
}
