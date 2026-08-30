export interface WorkflowGovernanceResetState {
  fromVersion: number | null;
  toVersion: number | null;
  runKeyword: string;
  selectedRunId: string | null;
  selectedRunWorkflowId: string | null;
}

export function resetWorkflowGovernanceState(): WorkflowGovernanceResetState {
  return {
    fromVersion: null,
    toVersion: null,
    runKeyword: "",
    selectedRunId: null,
    selectedRunWorkflowId: null,
  };
}

export function getVersionRangeDefaults(items: readonly unknown[]): {
  fromVersion: number | null;
  toVersion: number | null;
} {
  const versions = items
    .map(item => {
      if (!item || typeof item !== "object") return null;
      const value = Number((item as { version?: unknown }).version);
      return Number.isFinite(value) && value > 0 ? value : null;
    })
    .filter((version): version is number => version !== null);

  return {
    toVersion: versions[0] ?? null,
    fromVersion: versions[1] ?? versions[0] ?? null,
  };
}
