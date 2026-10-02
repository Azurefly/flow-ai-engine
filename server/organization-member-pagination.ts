export type OrganizationMemberPageWindow = {
  page: number;
  pageSize: number;
  totalPages: number;
  offset: number;
  from: number;
  to: number;
};

/** Escape SQL LIKE wildcards while reserving % only for the surrounding search. */
export function organizationMemberSearchPattern(
  search: string
): string | undefined {
  const normalized = search.trim();
  if (!normalized) return undefined;
  return `%${normalized.replace(/[=%_]/g, character => `=${character}`)}%`;
}

export function organizationMemberPageWindow(
  page: number,
  pageSize: number,
  total: number
): OrganizationMemberPageWindow {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const safeTotal = Math.max(0, Math.floor(total));
  const totalPages = Math.ceil(safeTotal / safePageSize);
  const safePage = Math.max(
    1,
    Math.min(Math.floor(page) || 1, Math.max(totalPages, 1))
  );
  const offset = (safePage - 1) * safePageSize;
  return {
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    offset,
    from: safeTotal ? offset + 1 : 0,
    to: Math.min(offset + safePageSize, safeTotal),
  };
}
