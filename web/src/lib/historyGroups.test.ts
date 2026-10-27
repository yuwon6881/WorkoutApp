import { describe, expect, it } from 'vitest';
import { historyDay, historyMonths } from './historyGroups';

// Local noon keeps each date in its own day and month whatever the test machine's time zone.
const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12).toISOString();

describe('history months', () => {
  it('groups a newest-first page by calendar month and keeps its order', () => {
    const sessions = [
      { id: 'a', startedAt: at(2026, 10, 26) },
      { id: 'b', startedAt: at(2026, 10, 2) },
      { id: 'c', startedAt: at(2026, 9, 30) },
      { id: 'd', startedAt: at(2025, 9, 14) }
    ];
    const months = historyMonths(sessions);
    expect(months.map(month => month.label)).toEqual(['October 2026', 'September 2026', 'September 2025']);
    expect(months.map(month => month.sessions.map(session => session.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('returns no groups for an empty page', () => {
    expect(historyMonths([])).toEqual([]);
  });

  it('labels a row with its short month, day and full date', () => {
    expect(historyDay(at(2026, 10, 26))).toEqual({ month: 'Oct', day: '26', full: 'Monday, October 26, 2026' });
  });
});
