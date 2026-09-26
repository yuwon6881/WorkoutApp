import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { Session, WorkoutActivityItem } from '../types';
import { api } from '../lib/api';
import { weekDays } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import './TrainingCalendar.css';
import './TrainingCalendarLayout.css';

interface TrainingCalendarProps {
  onSession: (s: Session) => void;
}

const localDay = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

export function TrainingCalendar({ onSession }: TrainingCalendarProps) {
  const [offset, setOffset] = useState(0);
  const days = weekDays(offset);
  const [calendar, setCalendar] = useState<WorkoutActivityItem[]>([]);
  const [calendarError, setCalendarError] = useState('');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedDayError, setSelectedDayError] = useState('');

  useEffect(() => {
    const from = localDay(days[0]);
    const to = localDay(days[6]);
    const controller = new AbortController();
    api
      .activity(from, to, controller.signal)
      .then(next => {
        setCalendar(next);
        setCalendarError('');
      })
      .catch(() => {
        if (!controller.signal.aborted) setCalendarError('Calendar could not be refreshed.');
      });
    return () => controller.abort();
  }, [offset]);

  const monthYearLabel = (() => {
    const firstMonth = days[0].toLocaleDateString('en', { month: 'short' });
    const lastMonth = days[6].toLocaleDateString('en', { month: 'short' });
    const firstYear = days[0].getFullYear();
    const lastYear = days[6].getFullYear();
    if (firstMonth === lastMonth && firstYear === lastYear) {
      return `${days[0].toLocaleDateString('en', { month: 'long' })} ${firstYear}`;
    }
    if (firstYear === lastYear) {
      return `${firstMonth} – ${lastMonth} ${firstYear}`;
    }
    return `${firstMonth} ${firstYear} – ${lastMonth} ${lastYear}`;
  })();

  const completedCount = calendar.filter(item => item.status === 'completed').length;

  return (
    <section className="panel training-calendar-card" aria-label="Training calendar">
      <div className="calendar-card-header">
        <div className="calendar-title-wrap">
          <div className="calendar-title-row">
            <span className="calendar-icon-badge" aria-hidden="true">
              <CalendarDays size={18} />
            </span>
            <h3>Activity & Schedule</h3>
          </div>
          <span className="calendar-range-label">{monthYearLabel}</span>
        </div>
      </div>

      <div className="calendar-days-grid" role="grid" aria-label="Days of the week">
        {days.map(day => {
          const dayStr = localDay(day);
          const entries = calendar.filter(item => item.date === dayStr);
          const status = entries.some(e => e.status === 'in_progress')
            ? 'in_progress'
            : entries.some(e => e.status === 'completed')
              ? 'completed'
              : 'rest';
          const isToday = dayStr === localDay(new Date());
          const label =
            status === 'completed'
              ? 'workout completed'
              : status === 'in_progress'
                ? 'workout in progress'
                : 'no workout recorded';

          return (
            <Button
              presentation="plain"
              key={day.toISOString()}
              className={`calendar-day-cell day-${status} ${isToday ? 'today is-today' : ''}`}
              aria-label={`${day.toDateString()}, ${label}${isToday ? ', today' : ''}`}
              onClick={() => {
                setSelectedDay(day);
                setSelectedDayError('');
              }}
            >
              <span className="day-weekday">{day.toLocaleDateString('en', { weekday: 'short' })}</span>
              <strong className="day-number">{day.getDate()}</strong>
              <div className="day-status-indicator">
                {status === 'completed' ? (
                  <span className="day-status-disc completed" title="Workout completed">
                    <Check size={12} strokeWidth={2.8} aria-hidden="true" />
                    <span className="day-status-label">Done</span>
                  </span>
                ) : status === 'in_progress' ? (
                  <span className="day-status-disc in-progress" title="Workout in progress">
                    <span className="status-dot pulsing" aria-hidden="true" />
                    <span className="day-status-label">Active</span>
                  </span>
                ) : (
                  <span className="day-status-disc rest" title="Rest day">
                    <span className="rest-ring" aria-hidden="true" />
                    <span className="day-status-label">Rest</span>
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

      <div className="calendar-nav-controls" role="group" aria-label="Navigate weeks">
        <Button
          aria-label="Previous week"
          variant="secondary"
          className="calendar-nav-btn"
          onClick={() => setOffset(o => o - 1)}
        >
          <ChevronLeft size={18} />
        </Button>
        <Button
          aria-label="Return to this week"
          variant="secondary"
          className="calendar-today-btn"
          disabled={offset === 0}
          onClick={() => setOffset(0)}
        >
          <RotateCcw size={15} />
          <span>Current week</span>
        </Button>
        <Button
          aria-label="Next week"
          variant="secondary"
          className="calendar-nav-btn"
          onClick={() => setOffset(o => o + 1)}
        >
          <ChevronRight size={18} />
        </Button>
      </div>

      <div className="calendar-card-footer">
        <span className="calendar-week-summary">
          <span className="status-dot" />{' '}
          {offset === 0 ? 'This week: ' : 'Selected week: '}
          <strong>{completedCount}</strong> {completedCount === 1 ? 'workout' : 'workouts'} completed
        </span>
        <div className="calendar-legend-pills" aria-label="Calendar status legend">
          <span><i className="legend-dot completed" />Completed</span>
          <span><i className="legend-dot in-progress" />In progress</span>
        </div>
      </div>

      {calendarError && <p className="muted calendar-error">{calendarError}</p>}

      {selectedDay && (
        <CalendarDayModal
          day={selectedDay}
          entries={calendar.filter(item => item.date === localDay(selectedDay))}
          onClose={() => setSelectedDay(null)}
          onSession={async id => {
            try {
              const session = await api.getWorkout(id);
              setSelectedDay(null);
              onSession(session);
            } catch {
              setSelectedDayError('This workout could not be opened.');
            }
          }}
          error={selectedDayError}
        />
      )}
    </section>
  );
}

function CalendarDayModal({
  day,
  entries,
  onClose,
  onSession,
  error
}: {
  day: Date;
  entries: WorkoutActivityItem[];
  onClose: () => void;
  onSession: (id: string) => Promise<void>;
  error: string;
}) {
  return (
    <Modal
      title={day.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
      onClose={onClose}
    >
      <div className="modal-body calendar-day-details">
        {entries.length ? (
          entries.map(entry => (
            <div className="calendar-entry" key={entry.id}>
              <div>
                <strong>{entry.name}</strong>
                <span className="muted">{entry.status.replace('_', ' ')}</span>
              </div>
              <Button variant="tertiary" onClick={() => void onSession(entry.id)}>
                Open workout <ArrowRight size={15} />
              </Button>
            </div>
          ))
        ) : (
          <p className="muted">No workout recorded for this day.</p>
        )}
        {error && <div className="error-text" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
