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
  return `${date(from).toLocaleDateString('en', { month: 'short', day: 'numeric' })} – ${date(to).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
