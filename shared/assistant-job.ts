export type AssistantJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "needs_review";

export type AssistantJobPayload =
  | { kind: "message"; text: string; proposalId?: string; timeZone?: string }
  | { kind: "decide"; proposalId: string; approve: boolean };

export function assistantJobActive(status?: AssistantJobStatus) {
  return status === "queued" || status === "running";
}

export const assistantJobLabels: Record<AssistantJobStatus, string> = {
  queued: "已排队，等待处理",
  running: "后台正在处理，可离开后继续查看",
  completed: "本轮已完成",
  failed: "本轮处理失败",
  cancelled: "排队请求已取消",
  needs_review: "已提交，等待核对业务回执",
};

export const assistantJobErrors: Record<string, string> = {
  permission_changed: "账号、会话或工具授权已变化。",
  revision_changed: "会话已更新，请读取最新消息。",
  domain_rejected: "业务对象或提案状态已经改变。",
  tool_rejected: "工具未能完成此操作。",
  model_unavailable: "模型服务未能完成请求。",
  model_configuration: "请管理员检查模型配置。",
  model_response: "模型返回的内容未能完成本轮任务。",
  receipt_unavailable: "原提案仍可用于核对这次操作。",
  outcome_unknown: "请管理员核对该请求的目标业务记录。",
  worker_interrupted: "后台处理多次中断，请重试。",
  manual_applied: "管理员已核实业务操作生效。",
  manual_not_applied: "管理员已核实业务操作未生效。",
};
