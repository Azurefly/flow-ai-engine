/** A published workflow can create a new version only when its draft changed. */
export function canPublishWorkflowVersion(
  status: string | undefined,
  hasUnpublishedChanges: boolean
) {
  return status !== "published" || hasUnpublishedChanges;
}

export function isWorkflowDraftDirty(
  workflowId: string | null,
  persisted: { workflowId: string; name: string; definitionJson: string } | null,
  name: string,
  definition: unknown
) {
  return Boolean(workflowId && definition && persisted?.workflowId === workflowId &&
    (persisted.name !== name || !matchesWorkflowDefinitionSnapshot(persisted.definitionJson, definition)));
}

/** Advance only an acknowledged lifecycle revision; never replace local editor values. */
export function acknowledgeWorkflowUnpublish(
  base: { workflowId: string; name: string; definitionJson: string; definitionVersion: number } | null,
  submitted: { id: string; expectedDefinitionVersion: number },
  result: { id?: string; name?: string; definition?: unknown; status?: string; definitionVersion?: number } | null
) {
  if (!base || !result || !Number.isSafeInteger(submitted.expectedDefinitionVersion) || submitted.expectedDefinitionVersion < 1 ||
    base.workflowId !== submitted.id || result.id !== submitted.id ||
    result.status !== "draft" || result.definitionVersion !== submitted.expectedDefinitionVersion + 1 ||
    !Number.isSafeInteger(result.definitionVersion))
    return null;
  if (base.definitionVersion > result.definitionVersion) return base;
  if ((base.definitionVersion !== submitted.expectedDefinitionVersion && base.definitionVersion !== result.definitionVersion) ||
    result.name !== base.name || !matchesWorkflowDefinitionSnapshot(base.definitionJson, result.definition)) return null;
  if (base.definitionVersion === result.definitionVersion) return base;
  return { ...base, definitionVersion: result.definitionVersion };
}

function sortJsonObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonObjectKeys(nested)])
    );
  }
  return value;
}

/** Compare persisted JSON with an in-memory definition independent of key order. */
export function matchesWorkflowDefinitionSnapshot(
  snapshotJson: string | undefined,
  definition: unknown
) {
  if (!snapshotJson) return false;
  try {
    return (
      JSON.stringify(sortJsonObjectKeys(JSON.parse(snapshotJson))) ===
      JSON.stringify(sortJsonObjectKeys(definition))
    );
  } catch {
    return false;
  }
}
