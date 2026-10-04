import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { HistoryPage, ProgramSummary, Session, WorkoutActivityItem } from '../types';
import { api } from '../lib/api';
import { weekDays } from '../lib/training';
import { useWindowTier } from '../lib/breakpoints';
import { loadSessionDetail } from '../lib/sessionDetailLoad';
import { prefetchView } from '../app/lazyViews';
import { ProgramWeekCompletion } from './ProgramWeekCompletion';
import { Button } from './ui/Button';
import './TrainingCalendar.css';

interface TrainingCalendarProps {
  onSession: (s: Session) => void;
  program: ProgramSummary | null;
  refreshKey: string | HistoryPage;
  activeWorkoutId: string | null;
}

const localDay = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

export function TrainingCalendar({ onSession, program, refreshKey, activeWorkoutId }: TrainingCalendarProps) {
  const [offset, setOffset] = useState(0);
  const days = weekDays(offset);
  const rail = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const isTouching = useRef(false);
  const navigating = useRef(false);
  const [calendar, setCalendar] = useState<WorkoutActivityItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [calendarError, setCalendarError] = useState('');

  const navigateByWeek = useCallback((direction: number) => {
    if (!direction || navigating.current) return;
    navigating.current = true;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    setOffset(value => value + direction);
  }, []);

  useLayoutEffect(() => {
    navigating.current = false;
    const element = rail.current;
    if (!element) return;
    const centerWeek = () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      element.scrollLeft = element.firstElementChild?.getBoundingClientRect().width ?? 0;
    };
    centerWeek();
    const observer = new ResizeObserver(centerWeek);
    observer.observe(element);
    return () => observer.disconnect();
  }, [offset]);

  useEffect(() => () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
  }, []);

  const settleWeek = () => {
    if (isTouching.current || navigating.current) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      if (isTouching.current || navigating.current) return;
      const element = rail.current;
      const width = element?.firstElementChild?.getBoundingClientRect().width;
      if (!element || !width) return;
      const delta = element.scrollLeft - width;
      const threshold = Math.min(25, width * 0.1);
      if (delta > threshold) {
        navigateByWeek(1);
      } else if (delta < -threshold) {
        navigateByWeek(-1);
      } else if (Math.abs(delta) > 0) {
        element.scrollLeft = width;
      }
    }, 100);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    isTouching.current = true;
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    isTouching.current = false;
    const start = touchStart.current;
    touchStart.current = null;
    const element = rail.current;
    if (!start || !element) return;
    const end = e.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = Math.abs(end.clientY - start.y);
    const movedX = Math.abs(dx);
    if (movedX >= 25 && movedX > dy) {
      navigateByWeek(dx < 0 ? 1 : -1);
    } else {
      const width = element.firstElementChild?.getBoundingClientRect().width;
      if (width) element.scrollLeft = width;
    }
  };

  const handleTouchCancel = () => {
    isTouching.current = false;
    touchStart.current = null;
    const element = rail.current;
    const width = element?.firstElementChild?.getBoundingClientRect().width;
    if (element && width) element.scrollLeft = width;
  };

  useEffect(() => {
    const from = localDay(weekDays(offset - 1)[0]);
    const to = localDay(weekDays(offset + 1)[6]);
    const controller = new AbortController();
    api
      .activity(from, to, controller.signal)
      .then(next => {
        if (controller.signal.aborted) return;
        setInitialLoading(false);
        setCalendar(prev => {
          const map = new Map<string, WorkoutActivityItem>();
          for (const item of prev) map.set(`${item.id}-${item.date}`, item);
          for (const item of next) map.set(`${item.id}-${item.date}`, item);
          return Array.from(map.values());
        });
        setCalendarError('');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setInitialLoading(false);
          setCalendarError('Calendar could not be refreshed.');
        }
      });
    return () => controller.abort();
  }, [offset, refreshKey, activeWorkoutId]);

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

  const completed = calendar.filter(item => item.status === 'completed' &&
    item.date >= localDay(days[0]) && item.date <= localDay(days[6]));
  const compact = useWindowTier() === 'compact';

  return (<>
    {compact && <ProgramWeekCompletion program={program} standalone />}
    <section className="panel training-calendar-card" aria-label="Training calendar">
      <div className="calendar-card-header">
        {!compact && <ProgramWeekCompletion program={program} />}

        <div className="calendar-nav-controls">
          {offset !== 0 && (
            <Button
              variant="tertiary"
              className="calendar-today-btn"
              aria-label="Return to this week"
              onClick={() => setOffset(0)}
            >
              <RotateCcw size={15} />
              <span>This week</span>
            </Button>
          )}
          <div className="calendar-month-nav">
            <Button
              aria-label="Previous week"
              variant="tertiary"
              className="calendar-nav-btn"
              onClick={() => setOffset(value => value - 1)}
            >
              <ChevronLeft size={18} />
            </Button>
            <span className="calendar-month-label">{monthYearLabel}</span>
            <Button
              aria-label="Next week"
              variant="tertiary"
              className="calendar-nav-btn"
              onClick={() => setOffset(value => value + 1)}
            >
              <ChevronRight size={18} />
            </Button>
          </div>
        </div>
      </div>

      <div className="calendar-week-row">
        <div
          className="calendar-week-rail"
          ref={rail}
          onScroll={settleWeek}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          aria-label="Swipe to browse weeks"
          tabIndex={0}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              navigateByWeek(event.key === 'ArrowLeft' ? -1 : 1);
            }
          }}
        >
          {[-1, 0, 1].map(relativeWeek => (
            <div
              className="calendar-days-grid"
              key={relativeWeek}
              inert={relativeWeek !== 0}
              role="group"
              aria-label={relativeWeek === 0 ? 'Days of the week' : relativeWeek < 0 ? 'Previous week days' : 'Next week days'}
            >
              {weekDays(offset + relativeWeek).map(day => {
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
                    onClick={async () => {
                      const performed = entries.find(e => e.status === 'completed')
                        ?? entries.find(e => e.status === 'in_progress')
                        ?? entries[0];
                      if (!performed) return;
                      prefetchView('sessionDetail');
                      try {
                        const session = await loadSessionDetail(performed.id);
                        onSession(session);
                      } catch {
                        setCalendarError('This workout could not be opened.');
                      }
                    }}
                  >
                    <span className="day-weekday">{day.toLocaleDateString('en', { weekday: 'short' })}</span>
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
          ))}
        </div>
      </div>

      <div className="calendar-card-footer">
        <p className="calendar-week-count">
          {initialLoading && calendar.length === 0
            ? (calendarError || 'Loading activity')
            : calendarError
              ? 'Activity unavailable'
              : `${completed.length} ${completed.length === 1 ? 'workout' : 'workouts'} completed in this calendar week`}
        </p>
        <div className="calendar-legend-pills" aria-label="Calendar status legend">
          <span className="calendar-legend-pill"><i className="legend-dot completed" aria-hidden="true" />Completed</span>
          <span className="calendar-legend-pill"><i className="legend-dot in-progress" aria-hidden="true" />In progress</span>
          <span className="calendar-legend-pill"><i className="legend-dot rest" aria-hidden="true" />Rest</span>
        </div>
      </div>

      {calendarError && <p className="muted calendar-error">{calendarError}</p>}
    </section>
  </>);
}
