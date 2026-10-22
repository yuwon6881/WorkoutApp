import { describe, expect, it, vi } from 'vitest';
import { createCalendarWeekStore } from './calendarWeekStore';
import type { CalendarWeekSummary } from './calendarWeekSummary';

const week = (from: string, sessions: number | null): CalendarWeekSummary => ({
  from, to: from, totals: sessions === null ? null : { sessions, workingSets: 0, trainingMinutes: 0 }
});

describe('calendar week store', () => {
  it('starts empty and notifies subscribers when the week changes', () => {
    const store = createCalendarWeekStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.get()).toBeNull();
    store.set(week('2026-10-19', null));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()?.from).toBe('2026-10-19');
  });

  it('stays quiet when the same week and totals are published again', () => {
    const store = createCalendarWeekStore();
    const summary = week('2026-10-19', 2);
    store.set(summary);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ ...summary });
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying a listener once it unsubscribes', () => {
    const store = createCalendarWeekStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(week('2026-10-19', 1));
    expect(listener).not.toHaveBeenCalled();
  });
});
