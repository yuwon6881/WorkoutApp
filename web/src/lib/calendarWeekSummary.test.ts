import { describe, expect, it } from 'vitest';
import type { WorkoutActivityItem } from '../types';
import { calendarWeekLabel, calendarWeekRange, calendarWeekRelative, calendarWeekTotals } from './calendarWeekSummary';

describe('calendar week totals', () => {
  const completed = (id: string, date: string, workingSets = 12, trainingMinutes = 30): WorkoutActivityItem =>
    ({ id, name: id, date, status: 'completed', workingSets, trainingMinutes });

  it('includes both week boundaries and every completed workout on a day, excluding active and other weeks', () => {
    const activity = [completed('monday', '2026-10-12'), completed('sunday', '2026-10-18'),
      completed('second', '2026-10-18', 3, 10), completed('before', '2026-10-11'), completed('after', '2026-10-19'),
      { ...completed('active', '2026-10-14'), status: 'in_progress' as const }];
    expect(calendarWeekTotals(activity, '2026-10-12', '2026-10-18')).toEqual({ sessions: 3, workingSets: 27, trainingMinutes: 70 });
    expect(calendarWeekTotals(activity, '2026-10-19', '2026-10-25')).toEqual({ sessions: 1, workingSets: 12, trainingMinutes: 30 });
  });

  it('shows zero for a confirmed empty week and unknown metrics for older activity responses', () => {
    expect(calendarWeekTotals([], '2026-10-12', '2026-10-18')).toEqual({ sessions: 0, workingSets: 0, trainingMinutes: 0 });
    expect(calendarWeekTotals([{ id: 'old', name: 'Old', date: '2026-10-14', status: 'completed' }], '2026-10-12', '2026-10-18'))
      .toEqual({ sessions: 1, workingSets: null, trainingMinutes: null });
  });
});

describe('calendar week label', () => {
  it('names the year once when the week stays inside it', () => {
    expect(calendarWeekLabel('2026-10-12', '2026-10-18')).toBe('Oct 12 – Oct 18, 2026');
  });

  it('names both years when the week crosses New Year', () => {
    expect(calendarWeekLabel('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });
});

describe('calendar week range', () => {
  it('names the month once inside a month and both months across one', () => {
    expect(calendarWeekRange('2026-11-02', '2026-11-08', 2026)).toBe('Nov 2 – 8');
    expect(calendarWeekRange('2026-10-26', '2026-11-01', 2026)).toBe('Oct 26 – Nov 1');
  });

  it('adds the year only for weeks outside the current one', () => {
    expect(calendarWeekRange('2025-11-03', '2025-11-09', 2026)).toBe('Nov 3 – 9, 2025');
    expect(calendarWeekRange('2025-12-29', '2026-01-04', 2026)).toBe('Dec 29, 2025 – Jan 4, 2026');
  });

  it('says where the week sits relative to this one', () => {
    expect([-3, -1, 0, 1, 2].map(calendarWeekRelative)).toEqual(['3 weeks ago', 'Last week', 'This week', 'Next week', 'In 2 weeks']);
  });
});
