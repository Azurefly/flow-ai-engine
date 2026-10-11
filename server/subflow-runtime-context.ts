type JsonRecord = Record<string, unknown>;
export type SubflowRuntimeContext = {
  runtime: JsonRecord;
  invocationBase: string[];
};

export function subflowRuntimeContext(
  parent: JsonRecord,
  subflowId: string
): SubflowRuntimeContext | undefined {
  const version = parent.httpIdempotencyVersion ?? 1;
  if (version !== 1 && version !== 2 && version !== 3)
    throw new Error("子流程执行策略版本无效。");
  // Existing runs retain their original inline context and HTTP header policy.
  if (version !== 3) return undefined;
  const runId =
    typeof parent.executionRunId === "string"
      ? parent.executionRunId.trim()
      : "";
  const nodeId =
    typeof parent.executionNodeId === "string"
      ? parent.executionNodeId.trim()
      : "";
  if (!runId || !nodeId || !subflowId.trim())
    throw new Error("子流程缺少父运行执行身份。");
  const path = parent.httpInvocationPath ?? [nodeId];
  if (
    !Array.isArray(path) ||
    !path.length ||
    path.some(part => typeof part !== "string" || !part.trim()) ||
    path[path.length - 1] !== nodeId
  )
    throw new Error("子流程父执行路径无效。");
  const runtime: JsonRecord = {
    httpIdempotencyVersion: 3,
    executionRunId: runId,
    nodeParticipantUserIds: {},
  };
  for (const key of [
    "triggeredByUserId",
    "lastActorUserId",
    "participantUserIds",
    "currentNodeParticipantUserIds",
    "receiverUserIds",
    "roleKeysByUser",
    "requestId",
    "parallelActiveTokens",
  ])
    if (parent[key] !== undefined) runtime[key] = structuredClone(parent[key]);
  return { runtime, invocationBase: [...path, "$subflow", subflowId] };
}
