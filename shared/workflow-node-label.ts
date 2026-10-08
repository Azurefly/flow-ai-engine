import type { FlowNodeType } from "./workflow-node-contract";
const labels: Record<FlowNodeType, string> = {
  start: "开始",
  end: "结束",
  state: "状态节点",
  operate: "操作节点",
  router: "路由节点",
  rest: "REST 节点",
  method: "方法节点",
  form: "表单节点",
  wait: "等待",
  message_catch: "消息等待",
  milestone: "里程碑",
  sql: "SQL 节点",
  transform: "转换",
  condition: "条件",
  llm: "LLM",
  subflow: "子流程",
  http: "HTTP",
  source: "资源",
  table: "中间表",
  filter: "筛选",
  map: "字段映射",
  project: "投影",
  derive: "派生",
  join: "关联",
  union: "合并",
  aggregate: "聚合",
  sort: "排序",
  deduplicate: "去重",
  quality_gate: "质量门",
  edit_sql: "SQL",
  udf: "函数",
  sink: "输出",
  output: "输出",
};
export function workflowNodeTypeLabel(type: unknown): string {
  return typeof type === "string"
    ? Object.hasOwn(labels, type)
      ? labels[type as FlowNodeType]
      : type
    : "未知节点";
}
