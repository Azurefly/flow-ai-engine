/** A published workflow can create a new version only when its draft changed. */
export function canPublishWorkflowVersion(
  status: string | undefined,
  hasUnpublishedChanges: boolean
) {
  return status !== "published" || hasUnpublishedChanges;
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
