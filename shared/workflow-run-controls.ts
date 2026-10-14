export type WorkflowRunControlAction = "pause" | "resume" | "cancel" | "terminate";
export type WorkflowRunControlCapabilities = {
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canTerminate: boolean;
  disabledReason: string | null;
};

export function isWorkflowRunController(userId: number, run: { triggeredByUserId?: unknown; ownerUserId?: unknown } | null | undefined) {
  const matches = (value: unknown) => (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) && Number(value) === userId;
  return Number.isSafeInteger(userId) && userId > 0 && Boolean(run && (matches(run.triggeredByUserId) || matches(run.ownerUserId)));
}

export function workflowRunControlCapabilities(userId: number, run: Record<string, unknown>, hasRunPermission: boolean): WorkflowRunControlCapabilities {
  const controller = isWorkflowRunController(userId, { triggeredByUserId: run.triggeredByUserId, ownerUserId: run.ownerUserId });
  const allowed = hasRunPermission === true && controller;
  const active = ["queued", "running", "waiting", "blocked"].includes(String(run.status));
  return {
    canPause: allowed && ["queued", "waiting"].includes(String(run.status)),
    canResume: allowed && run.status === "blocked",
    canCancel: allowed && active,
    canTerminate: allowed && active,
    disabledReason: !active || allowed ? null : !hasRunPermission ? "当前账号没有此流程的运行权限，仅可查看运行记录。" : "仅流程发起人或流程所有者可控制此运行。",
  };
}

export function workflowRunControlAllowed(capabilities: WorkflowRunControlCapabilities | null | undefined, action: WorkflowRunControlAction) {
  return capabilities?.[{ pause: "canPause", resume: "canResume", cancel: "canCancel", terminate: "canTerminate" }[action] as keyof WorkflowRunControlCapabilities] === true;
}
