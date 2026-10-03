import type { NodeField, NodeConfig } from "./workflow-node-contract";

const modes: Record<string, string[]> = {
  assigneeRoleCode: ["role"],
  assigneeUserId: ["user"],
  managerLevel: ["initiator_manager_n", "sender_manager_n"],
  assigneeUnitIds: ["department", "department_manager"],
  includeDescendants: ["department"],
  assigneeFormField: ["form_user"],
};

export function operateParticipantFields(
  fields: NodeField[],
  config: NodeConfig
) {
  const mode = String(config.assigneeMode ?? "receivers");
  return fields
    .filter(field => !modes[field.key] || modes[field.key].includes(mode))
    .map(field =>
      ["assigneeUserId", "assigneeRoleCode", "assigneeFormField"].includes(
        field.key
      )
        ? { ...field, required: true }
        : field
    );
}
