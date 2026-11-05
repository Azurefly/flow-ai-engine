export type WorkflowViewState =
  | "checking"
  | "unavailable"
  | "denied"
  | "granted";

/** Known access rejections are distinct from transport/server uncertainty. */
export function workflowReadFailureState(code?: string): "denied" | "unavailable" {
  return /^(UNAUTHORIZED|FORBIDDEN|NOT_FOUND)$/.test(code ?? "")
    ? "denied"
    : "unavailable";
}

/** Cached definitions may be displayed only after a matching successful access read. */
export function workflowViewState(input: {
  workflowId: string | null;
  accessWorkflowId: string;
  status: "pending" | "error" | "success";
  errorCode?: string;
  exists?: boolean;
  permissions?: ReadonlySet<string> | null;
}): WorkflowViewState {
  if (
    !input.workflowId ||
    input.workflowId !== input.accessWorkflowId ||
    input.status === "pending"
  )
    return "checking";
  if (input.status === "error") return workflowReadFailureState(input.errorCode);
  return input.exists === true && input.permissions?.has("workflow:view")
    ? "granted"
    : "denied";
}
