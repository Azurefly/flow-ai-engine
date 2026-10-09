export function normalizeRoleAuditEvent<T extends Record<string, unknown>>(
  event: T
): T {
  if (event.action !== "user_updated" || event.resourceType !== "iam_role")
    return event;
  let details = event.detailsJson;
  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      return event;
    }
  }
  if (!details || typeof details !== "object" || Array.isArray(details))
    return event;
  const operations: Record<string, string> = {
    custom_role_created: "role_created",
    custom_role_updated: "role_updated",
    custom_role_deleted: "role_deleted",
  };
  const operation = (details as Record<string, unknown>).operation;
  if (typeof operation !== "string" || !Object.hasOwn(operations, operation))
    return event;
  return Object.assign({}, event, {
    action: operations[operation],
    legacyAction: event.action,
  });
}
