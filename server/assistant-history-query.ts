export type HistoryScope = {
  preview: boolean;
  agentId?: string;
  projectId?: string | null;
  configVersion?: number;
  search?: string;
};

// Each optional equality prefix needs the same ordered suffix, including the ID tie-breaker.
export const assistantHistoryIndexes = {
  assistant_history_owner_idx: "ownerUserId:A,trial:A,updatedAt:D,id:A",
  assistant_history_project_idx: "ownerUserId:A,trial:A,projectId:A,updatedAt:D,id:A",
  assistant_history_agent_idx: "ownerUserId:A,trial:A,agentId:A,updatedAt:D,id:A",
  assistant_history_project_agent_idx: "ownerUserId:A,trial:A,projectId:A,agentId:A,updatedAt:D,id:A",
} as const;

function historyIndex(scope: HistoryScope): keyof typeof assistantHistoryIndexes {
  if (scope.projectId !== undefined)
    return scope.agentId !== undefined ? "assistant_history_project_agent_idx" : "assistant_history_project_idx";
  return scope.agentId !== undefined ? "assistant_history_agent_idx" : "assistant_history_owner_idx";
}

export function assistantHistoryQuery(
  ownerUserId: number, scope: HistoryScope, limit: number, after?: { time: number; id: string }
) {
  const conditions = ["s.ownerUserId=?", "s.trial=?"];
  const values: Array<string | number | boolean | null> = [ownerUserId, scope.preview];
  for (const [condition, value] of [
    ["s.projectId <=> ?", scope.projectId], ["s.agentId=?", scope.agentId],
    ["s.configVersion=?", scope.configVersion], ["LOCATE(?,s.title)>0", scope.search || undefined],
  ] as const) {
    if (value !== undefined) { conditions.push(condition); values.push(value); }
  }
  if (after) {
    conditions.push("(s.updatedAt<FROM_UNIXTIME(?) OR (s.updatedAt=FROM_UNIXTIME(?) AND s.id>?))");
    values.push(after.time, after.time, after.id);
  }
  values.push(limit);
  // Walk the history range first even when an agent is much more selective across the whole database.
  const sql = `SELECT s.id,s.title,s.agentId,s.configJson->>'$.name' AS agentName,s.projectId,s.workflowId,
      s.trial,s.configVersion,s.revision,s.updatedAt,UNIX_TIMESTAMP(s.updatedAt) AS sortTime,a.publishedJson
    FROM assistant_session s FORCE INDEX (${historyIndex(scope)}) STRAIGHT_JOIN assistant_agent a ON a.id=s.agentId
    WHERE ${conditions.join(" AND ")} ORDER BY s.updatedAt DESC,s.id ASC LIMIT ?`;
  return { sql, values };
}
