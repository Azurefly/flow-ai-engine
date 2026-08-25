import type { FlowNodeType, FlowType } from "./workflow-node-contract";

export type FlowRuntimeKind = "workflow" | "dataflow";

export type FlowProfileDefinition = {
  type: FlowType;
  label: string;
  description: string;
  version: number;
  runtimeKind: FlowRuntimeKind;
  allowedNodeTypes: readonly FlowNodeType[];
};

const STATE_NODE_TYPES = [
  "start",
  "end",
  "state",
  "operate",
  "router",
  "rest",
  "method",
  "form",
  "wait",
  "message_catch",
  "transform",
  "condition",
  "http",
  "llm",
  "subflow",
] as const satisfies readonly FlowNodeType[];

const CONTROL_NODE_TYPES = [
  "start",
  "end",
  "operate",
  "router",
  "rest",
  "method",
  "form",
  "wait",
  "message_catch",
  "milestone",
  "transform",
  "condition",
  "http",
  "llm",
  "subflow",
] as const satisfies readonly FlowNodeType[];

/** Keep this list aligned with the currently enabled P2 dataflow executor. */
const DATA_NODE_TYPES = [
  "start",
  "end",
  "source",
  "table",
  "sql",
  "transform",
  "filter",
  "map",
  "edit_sql",
  "udf",
  "sink",
  "output",
] as const satisfies readonly FlowNodeType[];

export const FLOW_PROFILES: Record<FlowType, FlowProfileDefinition> = {
  state: {
    type: "state",
    label: "状态流程",
    description: "维护业务状态、当前参与人和可执行操作。",
    version: 3,
    runtimeKind: "workflow",
    allowedNodeTypes: STATE_NODE_TYPES,
  },
  control: {
    type: "control",
    label: "控制流程",
    description: "编排系统动作、外部调用、AI 和人工闸门。",
    version: 4,
    runtimeKind: "workflow",
    allowedNodeTypes: CONTROL_NODE_TYPES,
  },
  data: {
    type: "data",
    label: "数据流程",
    description: "处理项目隔离的数据集 DAG。",
    version: 1,
    runtimeKind: "dataflow",
    allowedNodeTypes: DATA_NODE_TYPES,
  },
};

export function getFlowProfile(flowType: FlowType) {
  return FLOW_PROFILES[flowType];
}

export function getAllowedFlowNodeTypes(flowType: FlowType) {
  return FLOW_PROFILES[flowType].allowedNodeTypes;
}

export function isFlowNodeAllowed(flowType: FlowType, nodeType: FlowNodeType) {
  return FLOW_PROFILES[flowType].allowedNodeTypes.includes(nodeType);
}

export function isRuntimeKindAllowed(
  flowType: FlowType,
  runtimeKind: FlowRuntimeKind
) {
  return FLOW_PROFILES[flowType].runtimeKind === runtimeKind;
}
