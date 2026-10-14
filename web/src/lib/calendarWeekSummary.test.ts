import { describe, expect, it } from 'vitest';
import type { WorkoutActivityItem } from '../types';
import { calendarWeekTotals } from './calendarWeekSummary';

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
