export function canRevokeProjectGrant(grant: {
  role: string;
  protectedOwner?: number | boolean;
}) {
  return (
    grant.protectedOwner === 0 ||
    grant.protectedOwner === false ||
    (grant.protectedOwner === undefined && grant.role !== "owner")
  );
}
