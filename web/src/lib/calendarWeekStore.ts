import type { CalendarWeekSummary } from './calendarWeekSummary';

/// Holds the week the calendar shows so Overview's totals can follow it without the page above
/// both re-rendering (and rebuilding every card and the history list) on each swipe.
export interface CalendarWeekStore {
  get: () => CalendarWeekSummary | null;
  set: (week: CalendarWeekSummary) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createCalendarWeekStore(): CalendarWeekStore {
  let week: CalendarWeekSummary | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => week,
    set: next => {
      if (week && week.from === next.from && week.to === next.to && week.totals === next.totals) return;
      week = next;
      listeners.forEach(listener => listener());
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
}
