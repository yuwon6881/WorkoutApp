import { memo, useMemo } from 'react';
import { Check } from 'lucide-react';
import type { WorkoutActivityItem } from '../types';
import { localDate, weekDays } from '../lib/training';
import { Button } from './ui/Button';

const WEEKDAY = new Intl.DateTimeFormat('en', { weekday: 'short' });

type DayStatus = 'completed' | 'in_progress' | 'rest';

function dayStatus(entries: WorkoutActivityItem[]): DayStatus {
  if (entries.some(entry => entry.status === 'in_progress')) return 'in_progress';
  return entries.some(entry => entry.status === 'completed') ? 'completed' : 'rest';
}

const STATUS_LABEL: Record<DayStatus, string> = {
  completed: 'workout completed',
  in_progress: 'workout in progress',
  rest: 'no workout recorded'
};

interface TrainingCalendarWeekProps {
  weekOffset: number;
  /** The local date today, so the week is rebuilt (and today re-marked) after midnight. */
  today: string;
  entriesByDay: Map<string, WorkoutActivityItem[]>;
  inert: boolean;
  label: string;
  onOpenDay: (entries: WorkoutActivityItem[]) => void;
}

/// One week of day cells. Memoised because the calendar re-renders for every swipe and every read,
/// and its three weeks would otherwise rebuild twenty-one dates and labels each time.
export const TrainingCalendarWeek = memo(function TrainingCalendarWeek(
  { weekOffset, today, entriesByDay, inert, label, onOpenDay }: TrainingCalendarWeekProps
) {
  const days = useMemo(
    () => weekDays(weekOffset).map(day => ({
      day,
      key: localDate(day),
      weekday: WEEKDAY.format(day),
      text: day.toDateString()
    })),
    [weekOffset, today]
  );

  return (
    <div className="calendar-days-grid" inert={inert} role="group" aria-label={label}>
      {days.map(({ day, key, weekday, text }) => {
        const entries = entriesByDay.get(key) ?? [];
        const status = dayStatus(entries);
        const isToday = key === today;

        return (
          <Button
            presentation="plain"
            key={key}
            className={`calendar-day-cell day-${status} ${isToday ? 'today is-today' : ''}`}
            aria-label={`${text}, ${STATUS_LABEL[status]}${isToday ? ', today' : ''}`}
            onClick={() => onOpenDay(entries)}
          >
            <span className="day-weekday">{weekday}</span>
            <strong className="day-number">{day.getDate()}</strong>
            <div className="day-status-indicator">
              {status === 'completed' ? (
                <span className="day-status-disc completed" title="Workout completed">
                  <Check size={13} strokeWidth={2.8} aria-hidden="true" />
                  <span className="day-status-label">Done</span>
                </span>
              ) : status === 'in_progress' ? (
                <span className="day-status-disc in-progress" title="Workout in progress">
                  <span className="status-dot" aria-hidden="true" />
                  <span className="day-status-label">Active</span>
                </span>
              ) : (
                <span className="day-status-disc rest" title="No workout recorded">
                  <span className="rest-ring" aria-hidden="true" />
                  <span className="day-status-label">No workout</span>
                </span>
              )}
              <span className="day-marker" aria-hidden="true">
                {status === 'completed' ? '✓' : status === 'in_progress' ? '…' : '·'}
              </span>
            </div>
          </Button>
        );
      })}
    </div>
  );
});
