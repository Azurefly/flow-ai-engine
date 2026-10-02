export function canStartActualWorkflowRun(input: {
  canRun: boolean;
  isRunning: boolean;
  acknowledged: boolean;
}): boolean {
  return input.canRun && !input.isRunning && input.acknowledged;
}
