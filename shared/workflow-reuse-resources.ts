import { isFlowNodeAllowed } from "./flow-profile-contract";
import type { FlowNodeType, FlowType } from "./workflow-node-contract";

export function availableWorkflowReuseResources<
  T extends { nodeType: FlowNodeType },
  S extends { isEnabled: boolean },
>(flowType: FlowType, templates: readonly T[], subflows: readonly S[]) {
  const availableTemplates = templates.filter(template =>
    isFlowNodeAllowed(flowType, template.nodeType)
  );
  const availableSubflows = isFlowNodeAllowed(flowType, "subflow")
    ? subflows.filter(subflow => subflow.isEnabled)
    : [];
  return {
    availableTemplates,
    availableSubflows,
    count: availableTemplates.length + availableSubflows.length,
  };
}
