export function projectCapabilities(
  permissions: ReadonlySet<string> | undefined,
  confirmed: boolean
) {
  const ready = confirmed && Boolean(permissions?.has("project:view"));
  const has = (permission: string) =>
    ready && Boolean(permissions?.has(permission));
  return {
    ready,
    canManage: has("project:manage"),
    canCreate: has("project:workflow:create"),
    canEdit: has("project:workflow:edit"),
    canRun: has("project:workflow:run"),
  };
}
