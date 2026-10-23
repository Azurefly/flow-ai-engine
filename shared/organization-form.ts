export type OrganizationTarget = {
  kind:
    | "unit"
    | "member"
    | "new-user"
    | "move"
    | "role"
    | "remove"
    | "primary"
    | "unbind"
    | "status"
    | "delete";
  mode?: "root" | "sibling" | "child" | "edit";
  unit?: Record<string, any> | null;
  member?: Record<string, any>;
  binding?: Record<string, any>;
  status?: "active" | "disabled";
  affectedMemberCount?: number;
};
export type OrganizationFields = Record<string, string | boolean>;
export function organizationUnitFields(
  unit?: Record<string, any> | null
): OrganizationFields {
  return {
    code: unit?.code || "",
    name: unit?.name || "",
    parentUnitId: unit?.parentUnitId || "",
    managerUserId: unit?.managerUserId ? String(unit.managerUserId) : "",
    unitType: unit ? unit.unitType || "" : "department",
    managerLabel: unit?.managerUserId
      ? unit.managerName
        ? `${unit.managerName}（${unit.managerUsername || ""}）`
        : unit.managerUsername || ""
      : "",
    unitLevel: unit?.unitLevel ? String(unit.unitLevel) : "",
    standardCode: unit?.standardCode || "",
    areaCode: unit?.areaCode || "",
    category: unit?.category || "",
    sortOrder: String(unit?.sortOrder ?? 0),
    description: unit?.description || "",
  };
}
export function initialOrganizationDraft(target: OrganizationTarget) {
  let fields: OrganizationFields = {};
  if (target.kind === "unit") {
    fields = organizationUnitFields(
      target.mode === "edit" ? target.unit : null
    );
    if (target.mode === "child") fields.parentUnitId = target.unit?.id || "";
    if (target.mode === "sibling")
      fields.parentUnitId = target.unit?.parentUnitId || "";
  } else if (target.kind === "member")
    fields = {
      userId: target.member ? String(target.member.userId) : "",
      title: target.member?.title || "",
      isPrimary: target.member ? Boolean(target.member.isPrimary) : true,
    };
  else if (target.kind === "new-user")
    fields = {
      username: "",
      name: "",
      password: "",
      email: "",
      role: "user",
      title: "",
      isPrimary: true,
    };
  else if (target.kind === "move")
    fields = {
      toUnitId: "",
      title: target.member?.title || "",
      makePrimary: Boolean(target.member?.isPrimary),
      confirmMerge: false,
    };
  else if (target.kind === "role")
    fields = { roleId: "", includeDescendants: true, expiresAt: "" };
  return {
    fields,
    base: { ...fields },
    configToken: String(
      target.binding?.configToken || target.unit?.configToken || ""
    ),
    membershipToken: String(target.member?.membershipToken || ""),
    roleToken: "",
    createdUserId: null as number | null,
    attempted: false,
  };
}
export function mergeOrganizationFields(
  base: OrganizationFields,
  fields: OrganizationFields,
  latest: OrganizationFields
) {
  return Object.fromEntries(
    Object.keys(latest).map(key => [
      key,
      fields[key] !== base[key] ? fields[key] : latest[key],
    ])
  );
}
export function organizationDraftKey(target: OrganizationTarget) {
  return [
    target.kind,
    target.mode,
    target.unit?.id,
    target.member?.userId,
    target.binding?.id,
    target.unit?.configToken,
    target.member?.membershipToken,
    target.binding?.configToken,
  ].join(":");
}
