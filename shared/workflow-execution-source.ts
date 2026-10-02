export type WorkflowExecutionSource =
  | "published_plan"
  | "saved_definition"
  | "draft";

export function resolveWorkflowExecutionSource(input: {
  workflowStatus: string;
  publishedPlan: unknown;
  publishedPlanHash: string | null | undefined;
}): WorkflowExecutionSource {
  if (input.workflowStatus !== "published") return "draft";
  if (input.publishedPlan && input.publishedPlanHash) return "published_plan";
  return "saved_definition";
}
