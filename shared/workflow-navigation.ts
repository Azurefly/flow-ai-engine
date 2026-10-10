import type { ConsoleRoute } from "./console-route";

export function shouldConfirmWorkflowNavigation(
  unsavedWorkflowId: string | null,
  target: ConsoleRoute
) {
  return Boolean(unsavedWorkflowId && !(target.section === "flows" && target.view === "editor" && target.workflowId === unsavedWorkflowId));
}
