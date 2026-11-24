import type { ConsoleRoute } from "./console-route";

export type AssistantScope = { projectId?: string | null; workflowId?: string | null };
export type AssistantObjectFocus = { kind: "workflowRun" | "dataRun" | "task"; id: string };

export function sameAssistantScope(left: AssistantScope, right: AssistantScope) {
  return (left.projectId ?? null) === (right.projectId ?? null) &&
    (left.workflowId ?? null) === (right.workflowId ?? null);
}

export function assistantStorageKey(userId: number, scope: AssistantScope, trial?: { id: string; version: number }) {
  // Existing trial sessions already have a project-specific storage key.
  if (trial && !scope.workflowId) return ["flow.assistant", userId, trial.id, trial.version, scope.projectId ?? ""].join(".");
  return "flow.assistant.scope." + JSON.stringify([
    userId, trial?.id ?? null, trial?.version ?? null, scope.projectId ?? null, scope.workflowId ?? null,
  ]);
}

export function assistantScopeRoute(scope: AssistantScope): ConsoleRoute {
  if (scope.workflowId) return { section: "flows", view: "detail", workflowId: scope.workflowId };
  if (scope.projectId) return { section: "flows", view: "workspace", projectId: scope.projectId };
  return { section: "flows", view: "center" };
}
