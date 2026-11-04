import type { WorkoutActivityItem } from '../types';

export type TrainingTotals = { sessions: number; workingSets: number | null; trainingMinutes: number | null };
export type CalendarWeekSummary = { from: string; to: string; totals: TrainingTotals | null };

export function calendarWeekTotals(activity: WorkoutActivityItem[], from: string, to: string): TrainingTotals {
  const completed = activity.filter(item => item.status === 'completed' && item.date >= from && item.date <= to);
  return {
    sessions: completed.length,
    workingSets: completed.every(item => item.workingSets != null)
      ? completed.reduce((total, item) => total + item.workingSets!, 0) : null,
    trainingMinutes: completed.every(item => item.trainingMinutes != null)
      ? completed.reduce((total, item) => total + item.trainingMinutes!, 0) : null
  };
}

export function calendarWeekLabel(from: string, to: string): string {
  const date = (day: string) => new Date(`${day}T12:00:00`);
  const start = date(from);
  const end = date(to);
  // A week spanning New Year would otherwise read as if both ends fell in the closing year.
  const startOptions: Intl.DateTimeFormatOptions = start.getFullYear() === end.getFullYear()
    ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return `${start.toLocaleDateString('en', startOptions)} – ${end.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/// The calendar header's short range: "Nov 2 – 8", "Oct 26 – Nov 1", with the year only when the
/// week is not inside the current one ("Dec 29, 2025 – Jan 4, 2026").
export function calendarWeekRange(from: string, to: string, currentYear = new Date().getFullYear()): string {
  const date = (day: string) => new Date(`${day}T12:00:00`);
  const start = date(from);
  const end = date(to);
  const month = (value: Date) => value.toLocaleDateString('en', { month: 'short' });
  const withYear = start.getFullYear() !== currentYear || end.getFullYear() !== currentYear;
  if (withYear) {
    const full = (value: Date) => value.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    if (start.getFullYear() !== end.getFullYear()) return `${full(start)} – ${full(end)}`;
    const startText = `${month(start)} ${start.getDate()}`;
    const endText = start.getMonth() === end.getMonth() ? `${end.getDate()}` : `${month(end)} ${end.getDate()}`;
    return `${startText} – ${endText}, ${end.getFullYear()}`;
  }
  return start.getMonth() === end.getMonth()
    ? `${month(start)} ${start.getDate()} – ${end.getDate()}`
    : `${month(start)} ${start.getDate()} – ${month(end)} ${end.getDate()}`;
}

/// Where a shown week sits relative to this one, in words.
export function calendarWeekRelative(offset: number): string {
  if (offset === 0) return 'This week';
  if (offset === -1) return 'Last week';
  if (offset === 1) return 'Next week';
  return offset < 0 ? `${-offset} weeks ago` : `In ${offset} weeks`;
}
