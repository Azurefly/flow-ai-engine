export function canManageTask(
  task: { status?: unknown; canAct?: unknown } | null | undefined
) {
  return Boolean(
    task &&
      ["pending", "claimed"].includes(String(task.status)) &&
      task.canAct === true
  );
}
