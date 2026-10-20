/** Rendering waits for the route's own draft without adopting a query version. */
export function readWorkflowDraftBaseVersion(
  workflowId: string | null,
  snapshot: { workflowId: string; definitionVersion: number } | null
) {
  if (
    !workflowId ||
    !snapshot ||
    snapshot.workflowId !== workflowId ||
    !Number.isSafeInteger(snapshot.definitionVersion) ||
    snapshot.definitionVersion < 1
  )
    return null;
  return snapshot.definitionVersion;
}

export function workflowDraftBaseVersion(
  workflowId: string,
  snapshot: { workflowId: string; definitionVersion: number } | null
) {
  const version = readWorkflowDraftBaseVersion(workflowId, snapshot);
  if (version === null)
    throw new Error("编辑版本尚未就绪，请读取最新流程后再操作。");
  return version;
}
