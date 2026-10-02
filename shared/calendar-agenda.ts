export const CALENDAR_DAY_PREVIEW_LIMIT = 2;
export const CALENDAR_AGENDA_PAGE_SIZE = 10;

export type CalendarAgendaVisibilityAction = "show-more" | "collapse";

export function getCalendarAgendaVisibleLimit(
  totalCount: number,
  currentVisibleCount: number,
  action: CalendarAgendaVisibilityAction
) {
  const total = normalizeCount(totalCount);
  const current = Math.min(total, normalizeCount(currentVisibleCount));

  if (action === "collapse") {
    return Math.min(total, CALENDAR_DAY_PREVIEW_LIMIT);
  }

  const visible = Math.max(
    current,
    Math.min(total, CALENDAR_DAY_PREVIEW_LIMIT)
  );
  return Math.min(total, visible + CALENDAR_AGENDA_PAGE_SIZE);
}

function normalizeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
