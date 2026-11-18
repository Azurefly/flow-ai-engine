import { participantOperation, PARTICIPANT_SCOPE_OPTIONS } from "@shared/participant-state";
import { normalizeReferenceOperateConfig } from "@shared/reference-operate-config";
import { compileHttpServiceTask } from "@shared/service-task-contract";
import { FLOW_NODE_DEFINITIONS, readOperateOutcomes, type FlowNodeType, type NodeConfig } from "@shared/workflow-node-contract";

function hasParameters(value: unknown) {
  return Array.isArray(value) ? value.some(item => item && String(item.key ?? "").trim())
    : !!value && Object.keys(value).length > 0;
}

export function NodeConfigurationSummary({ kind, config, participantMode, operations, names }: {
  kind: FlowNodeType; config: NodeConfig; participantMode: boolean; operations: string[]; names: Record<string, string>;
}) {
  const rows: [string, string][] = [];
  if (kind === "state") {
    const state = FLOW_NODE_DEFINITIONS.state.fields.find(f => f.key === "stateType")?.options?.find(o => o.value === config.stateType);
    rows.push([state?.label || "状态", String(config.jdmc || config.displayName || "未填写名称")],
      ["可用操作", operations.join("、") || "未连接操作节点"]);
  } else if (kind === "operate") {
    if (participantMode) {
      const scope = participantOperation(config).scope;
      rows.push(["办理人", "当前状态卡持有人"], ["影响人员", PARTICIPANT_SCOPE_OPTIONS.find(o => o.value === scope)?.label || scope]);
      const outcomes = readOperateOutcomes(config);
      if (outcomes.length) rows.push(["办理结果", outcomes.map(o => o.label).join("、")]);
    } else {
      const assignee = FLOW_NODE_DEFINITIONS.operate.fields.find(f => f.key === "assigneeMode")?.options?.find(o => o.value === config.assigneeMode);
      const { signMode, passPercent, signSelectorUserIds } = normalizeReferenceOperateConfig(config);
      const mode = { single: "单人办理", orSignFor: "任一人通过", andSignFor: `会签 · 至少 ${Math.round(passPercent * 100)}% 通过`, sequentialSignFor: "按顺序全部通过" }[signMode];
      rows.push(["办理人", [assignee?.label || "未设置", signSelectorUserIds.length && signMode !== "single" ? `指定 ${signSelectorUserIds.length} 人` : ""].filter(Boolean).join(" · ")], ["通过方式", mode]);
    }
  } else if (kind === "rest" || kind === "method" || kind === "http") {
    try {
      const task = compileHttpServiceTask(kind, config)!;
      rows.push(["请求", [task.method, task.endpointRef, task.urlTemplate || "未填写路径"].filter(Boolean).join(" ")]);
      const inputs = [hasParameters(task.headersTemplate) && "请求头", hasParameters(task.queryTemplate) && "查询参数",
        task.method !== "GET" && task.bodyTemplate !== undefined && "请求体"].filter(Boolean);
      rows.push(["输入", inputs.join("、") || "未配置参数"], ["输出", "响应状态码、响应头、响应体"]);
      const retryable = task.retryClass === "safe_read" || task.writeSafety === "idempotent";
      const policy = [task.timeoutMs !== 15000 && `超时 ${task.timeoutMs / 1000} 秒`, retryable && task.retry.maxAttempts > 1 && `最多尝试 ${task.retry.maxAttempts} 次`,
        task.compensationNodeId && `补偿 · ${names[task.compensationNodeId] || task.compensationNodeId}`].filter(Boolean);
      if (policy.length) rows.push(["执行策略", policy.join("、")]);
    } catch { rows.push(["请求", "请检查请求设置"]); }
  } else return null;
  return <dl className="config-facts" aria-label="配置摘要">
    {rows.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
  </dl>;
}
