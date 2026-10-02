import { describe, expect, it } from "vitest";
import {
  CALENDAR_AGENDA_PAGE_SIZE,
  CALENDAR_DAY_PREVIEW_LIMIT,
  getCalendarAgendaVisibleLimit,
} from "./calendar-agenda";

describe("日历日期组渐进显示", () => {
  it("先显示两项，再按十项递增并在总数处停止", () => {
    expect(
      getCalendarAgendaVisibleLimit(
        129,
        CALENDAR_DAY_PREVIEW_LIMIT,
        "show-more"
      )
    ).toBe(CALENDAR_DAY_PREVIEW_LIMIT + CALENDAR_AGENDA_PAGE_SIZE);
    expect(getCalendarAgendaVisibleLimit(129, 12, "show-more")).toBe(22);
    expect(getCalendarAgendaVisibleLimit(129, 124, "show-more")).toBe(129);
  });

  it("不论显示到哪一批都能立即收起到前两项", () => {
    expect(getCalendarAgendaVisibleLimit(129, 12, "collapse")).toBe(2);
    expect(getCalendarAgendaVisibleLimit(129, 129, "collapse")).toBe(2);
  });

  it("处理小列表、负数和已过期的可见数量", () => {
    expect(getCalendarAgendaVisibleLimit(1, 0, "show-more")).toBe(1);
    expect(getCalendarAgendaVisibleLimit(1, 8, "collapse")).toBe(1);
    expect(getCalendarAgendaVisibleLimit(12, -4, "show-more")).toBe(12);
    expect(getCalendarAgendaVisibleLimit(-1, 10, "show-more")).toBe(0);
  });
});
