import {
  isFlowNodeType,
  nodeNumberConfigError,
} from "./workflow-node-contract";

export function workflowNumberDraftError(definition: unknown): string | null {
  if (!definition || typeof definition !== "object") return null;
  const nodes = (definition as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (
      !node ||
      typeof node !== "object" ||
      !isFlowNodeType(node.type) ||
      !node.config ||
      typeof node.config !== "object" ||
      Array.isArray(node.config)
    )
      continue;
    const error = nodeNumberConfigError(node.type, node.config);
    if (error)
      return `节点“${node.name || node.id || node.type}”的${error.message}请修正后再保存、发布或运行。`;
  }
  return null;
}
