export type SearchSelectOption = {
  value: string;
  label: string;
  keywords?: string;
};

export function searchSelectOptions<T extends SearchSelectOption>(
  options: readonly T[],
  query: string,
  limit = 50
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? options.filter(option =>
        `${option.label} ${option.keywords ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : [...options];
  const safeLimit = Math.max(1, Math.floor(limit));

  return {
    options: matches.slice(0, safeLimit),
    totalMatches: matches.length,
    hasMore: matches.length > safeLimit,
  };
}

export function toggleSearchSelection(
  values: readonly string[],
  nextValue: string,
  maxSelected = Number.POSITIVE_INFINITY
) {
  if (values.includes(nextValue))
    return values.filter(value => value !== nextValue);
  if (maxSelected <= 1) return [nextValue];
  return [...values, nextValue];
}
