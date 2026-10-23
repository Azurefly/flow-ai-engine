export type WorkflowOperationSource = {
  id: string;
  name: string;
  description: string | null;
  flowType: "state" | "control" | "data";
  projectId: string | null;
  definitionVersion: number;
  status: "draft" | "published";
  archivedAt: unknown;
  configurationToken: string;
  folderId: string | null;
  dataSourceId: string | null;
};
export type WorkflowOperationTarget =
  | { kind: "global" }
  | { kind: "project"; projectId: string; projectName: string }
  | { kind: "copy"; source: WorkflowOperationSource }
  | {
      kind: "archive";
      source: WorkflowOperationSource;
      unsavedChanges?: boolean;
    };

export function workflowCopyName(name: string) {
  let prefix = "";
  for (const character of name) {
    if (prefix.length + character.length > 154) break;
    prefix += character;
  }
  return prefix + " · 副本";
}
export function workflowCreationScope(target: WorkflowOperationTarget) {
  return target.kind === "project"
    ? target.projectId
    : target.kind === "global"
      ? "workflow-global"
      : target.source.projectId || "workflow-global";
}
export function workflowCreationCategory(target: WorkflowOperationTarget) {
  return target.kind === "copy" || target.kind === "archive"
    ? "workflow-" + target.kind + ":" + target.source.id
    : "workflow-create";
}
export function initialWorkflowCreationFields(target: WorkflowOperationTarget) {
  return {
    name:
      target.kind === "copy"
        ? workflowCopyName(target.source.name)
        : target.kind === "global"
          ? "新流程"
          : "",
    processCode: "",
    description: "",
    flowType: "state" as "state" | "control" | "data",
    dataSourceId: "",
  };
}
