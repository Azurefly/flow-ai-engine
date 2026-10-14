export function workflowDraftBaseVersion(workflowId: string, snapshot: { workflowId: string; definitionVersion: number } | null) {
  if (!snapshot || snapshot.workflowId !== workflowId || !Number.isSafeInteger(snapshot.definitionVersion) || snapshot.definitionVersion < 1)
    throw new Error("编辑版本尚未就绪，请读取最新流程后再操作。");
  return snapshot.definitionVersion;
}
