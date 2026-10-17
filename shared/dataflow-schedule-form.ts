export type DataflowScheduleForm = {
  workflowId: string;
  cronExpression: string;
  expectedRevision?: number;
};

/** Only rebase edits that were actually made against the submitted version. */
export function acceptDataflowScheduleVersion(
  current: DataflowScheduleForm,
  submitted: Pick<DataflowScheduleForm, "workflowId" | "expectedRevision">,
  revision: number
): DataflowScheduleForm {
  if (
    current.workflowId !== submitted.workflowId ||
    current.expectedRevision !== submitted.expectedRevision
  )
    return current;
  return { ...current, expectedRevision: revision };
}
