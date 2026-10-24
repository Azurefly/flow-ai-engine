import type { WorkflowDefinition } from "../server/workflow-compiler";

type Snapshot = { id: string; version: number; definition: WorkflowDefinition };

/** A preview is valid only for the exact editable draft it inspected. */
export function canApplyDataflowConfigConversion(
  current: Snapshot & { canEdit: boolean; busy: boolean },
  target: Snapshot
) {
  return (
    current.canEdit &&
    !current.busy &&
    current.id === target.id &&
    current.version === target.version &&
    JSON.stringify(current.definition) === JSON.stringify(target.definition)
  );
}
