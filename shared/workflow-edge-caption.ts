import { normalizeReferenceRouterConfig } from "./reference-router-config";
import { readConditionHandles, readOperateOutcomes, type NodeConfig } from "./workflow-node-contract";

export function workflowEdgeCaption(type: unknown, nodeConfig?: NodeConfig | null, handle = "default", label?: unknown) {
  const config = nodeConfig ?? {};
  const named = typeof label === "string" ? label.trim() : "";
  if (type === "operate") {
    const outcome = readOperateOutcomes(config).find(item => item.sourceHandle === handle);
    const code = outcome?.code ?? handle;
    return {
      label: outcome?.label || named,
      tone: code === "approved" ? "approve" : code === "rejected" ? "reject" : undefined,
    };
  }
  if (type === "router") {
    const router = normalizeReferenceRouterConfig(config);
    const rule = router.rules.find(item => item.handle === handle);
    const text = rule?.name && rule.name !== handle ? rule.name : named;
    return { label: text || (rule?.isDefault || handle === router.defaultRoute ? "默认分支" : "") };
  }
  if (type === "condition") {
    const [yes, no] = readConditionHandles(config);
    return { label: handle === yes ? "成立" : handle === no ? "不成立" : named };
  }
  return { label: named || (type === "llm" && handle && handle !== "default" ? "失败分支" : "") };
}
