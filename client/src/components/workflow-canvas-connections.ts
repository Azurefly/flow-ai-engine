import {
  canConnectFlowNodeTypes,
  readOperateOutcomeMode,
  type FlowType,
  type FlowNodeType,
  type NodeConfig,
} from "@shared/workflow-node-contract";

type CanvasEndpoint = {
  id: string;
  data: { kind: FlowNodeType; config: NodeConfig };
};
type CanvasConnection = {
  source: string;
  target: string;
  sourceHandle?: string | null;
};

export function canConnectCanvasNodes(
  source: CanvasEndpoint,
  target: CanvasEndpoint,
  edges: CanvasConnection[],
  flowType: FlowType
) {
  if (
    source.id === target.id ||
    source.data.kind === "end" ||
    target.data.kind === "start"
  )
    return false;
  if (!canConnectFlowNodeTypes(source.data.kind, target.data.kind))
    return false;
  const outgoing = edges.filter(edge => edge.source === source.id);
  const singleOutlet =
    (source.data.kind === "start" && flowType !== "data") ||
    source.data.kind === "rest" ||
    (source.data.kind === "operate" &&
      readOperateOutcomeMode(source.data.config) !== "explicit");
  if (singleOutlet && outgoing.length) return false;
  return !outgoing.some(
    edge =>
      edge.target === target.id &&
      (edge.sourceHandle || "default") === "default"
  );
}
