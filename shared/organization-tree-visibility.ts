type Unit = {
  id: string;
  parentUnitId?: string | null;
  status: string;
  name: string;
  code?: string;
  pathName?: string;
  pathCode?: string;
  standardCode?: string;
};
export function visibleOrganizationIds(
  units: Unit[],
  query: string,
  showDisabled: boolean
) {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const ids = new Set<string>();
  const term = query.trim().toLowerCase();
  for (const unit of units) {
    if (!showDisabled && unit.status !== "active") continue;
    if (
      term &&
      ![unit.name, unit.code, unit.pathName, unit.pathCode, unit.standardCode]
        .join(" ")
        .toLowerCase()
        .includes(term)
    )
      continue;
    let current: Unit | undefined = unit;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      ids.add(current.id);
      current = current.parentUnitId
        ? byId.get(current.parentUnitId)
        : undefined;
    }
  }
  return ids;
}
