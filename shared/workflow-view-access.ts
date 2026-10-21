export type WorkflowViewState =
  | "checking"
  | "unavailable"
  | "denied"
  | "granted";

/** Cached definitions may be displayed only after a matching successful access read. */
export function workflowViewState(input: {
  workflowId: string | null;
  accessWorkflowId: string;
  status: "pending" | "error" | "success";
  exists?: boolean;
  permissions?: ReadonlySet<string> | null;
}): WorkflowViewState {
  if (
    !input.workflowId ||
    input.workflowId !== input.accessWorkflowId ||
    input.status === "pending"
  )
    return "checking";
  if (input.status === "error") return "unavailable";
  return input.exists === true && input.permissions?.has("workflow:view")
    ? "granted"
    : "denied";
}
