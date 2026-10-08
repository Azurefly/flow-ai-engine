import { FLOW_NODE_TYPES, type FlowNodeType } from "./workflow-node-contract";

export type TemplateNodeType = Exclude<
  FlowNodeType,
  "start" | "end" | "subflow"
>;
export const TEMPLATE_NODE_TYPES = FLOW_NODE_TYPES.filter(
  (type): type is TemplateNodeType =>
    !["start", "end", "subflow"].includes(type)
);
export function isTemplateNodeType(type: unknown): type is TemplateNodeType {
  return (
    typeof type === "string" &&
    (TEMPLATE_NODE_TYPES as readonly string[]).includes(type)
  );
}
