export function resumeWorkflowQueue(
  pending: unknown,
  next: string[]
): string[] {
  if (
    pending !== undefined &&
    (!Array.isArray(pending) ||
      pending.some(id => typeof id !== "string" || !id.trim()))
  )
    throw new Error("流程剩余队列无效，无法安全恢复。");
  return [...((pending as string[] | undefined) ?? []), ...next];
}
