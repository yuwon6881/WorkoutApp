import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { HistoryPage, ProgramSummary, Session, WorkoutActivityItem } from '../types';
import { localDate, weekDays } from '../lib/training';
import { loadSessionDetail } from '../lib/sessionDetailLoad';
import { prefetchView } from '../app/lazyViews';
import { ProgramWeekCompletion } from './ProgramWeekCompletion';
import { Button } from './ui/Button';
import './TrainingCalendar.css';
import { TrainingCalendarWeek } from './TrainingCalendarWeek';
import { useCalendarActivity } from './useCalendarActivity';
import { calendarWeekTotals, type CalendarWeekSummary } from '../lib/calendarWeekSummary';

interface TrainingCalendarProps {
  onSession: (s: Session) => void;
  program: ProgramSummary | null;
  refreshKey: string | HistoryPage;
  activeWorkoutId: string | null;
  accountId: string;
  onWeekChange?: (week: CalendarWeekSummary) => void;
}

export function TrainingCalendar({ onSession, program, refreshKey, activeWorkoutId, accountId, onWeekChange }: TrainingCalendarProps) {
  const [offset, setOffset] = useState(0);
  const days = weekDays(offset);
  const rail = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const isTouching = useRef(false);
  const navigating = useRef(false);
  const weekFrom = localDate(days[0]);
  const weekTo = localDate(days[6]);
  const today = localDate(new Date());
  const { items: calendar, loading: initialLoading, error: readError } = useCalendarActivity({
    offset, accountId, activeWorkoutId, refreshKey, weekFrom, weekTo
  });
  const [openError, setOpenError] = useState('');
  const calendarError = readError || openError;
  useEffect(() => setOpenError(''), [offset]);
  const weekSummary = useMemo<CalendarWeekSummary>(() => ({
    from: weekFrom, to: weekTo,
    totals: initialLoading ? null : calendarWeekTotals(calendar, weekFrom, weekTo)
  }), [calendar, initialLoading, weekFrom, weekTo]);
  useEffect(() => { onWeekChange?.(weekSummary); }, [onWeekChange, weekSummary]);
  // Three weeks of day cells each look up their own date; group once per loaded calendar.
  const entriesByDay = useMemo(() => {
    const byDay = new Map<string, WorkoutActivityItem[]>();
    for (const item of calendar) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
    return byDay;
  }, [calendar]);

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

  const openDay = useCallback(async (entries: WorkoutActivityItem[]) => {
    const performed = entries.find(entry => entry.status === 'completed')
      ?? entries.find(entry => entry.status === 'in_progress')
      ?? entries[0];
    if (!performed) return;
    setOpenError('');
    prefetchView('sessionDetail');
    try {
      onSession(await loadSessionDetail(performed.id));
    } catch {
      setOpenError('This workout could not be opened.');
    }
  }, [onSession]);

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
    item.date >= weekFrom && item.date <= weekTo);
  return (
    <section className="panel training-calendar-card" aria-label="Training calendar">
      <div className="calendar-card-header">
        <ProgramWeekCompletion program={program} />

        <div className="calendar-nav-controls">
          <div className="calendar-reset-slot">
          {offset !== 0 && (
            <Button
              variant="tertiary"
              className="calendar-today-btn"
              aria-label="Return to this week"
              title="This week"
              onClick={() => setOffset(0)}
            >
              <RotateCcw size={15} />
              <span>This week</span>
            </Button>
          )}
          </div>
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
          aria-busy={initialLoading}
          data-loading={initialLoading || undefined}
          tabIndex={0}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              navigateByWeek(event.key === 'ArrowLeft' ? -1 : 1);
            }
          }}
        >
          {[-1, 0, 1].map(relativeWeek => (
            <TrainingCalendarWeek
              key={relativeWeek}
              weekOffset={offset + relativeWeek}
              today={today}
              entriesByDay={entriesByDay}
              inert={relativeWeek !== 0}
              label={relativeWeek === 0 ? 'Days of the week' : relativeWeek < 0 ? 'Previous week days' : 'Next week days'}
              onOpenDay={openDay}
            />
          ))}
        </div>
      </div>

      <div className="calendar-card-footer">
        <p className="calendar-week-count">
          {initialLoading
            ? (calendarError || 'Loading activity')
            : calendarError
              ? 'Activity unavailable'
              : `${completed.length} ${completed.length === 1 ? 'workout' : 'workouts'} completed this week`}
        </p>
        <div className="calendar-legend-pills" aria-label="Calendar status legend">
          <span className="calendar-legend-pill"><i className="legend-dot completed" aria-hidden="true" />Completed</span>
          <span className="calendar-legend-pill"><i className="legend-dot in-progress" aria-hidden="true" />In progress</span>
          <span className="calendar-legend-pill"><i className="legend-dot rest" aria-hidden="true" />No workout</span>
        </div>
      </div>

      {calendarError && <p className="muted calendar-error">{calendarError}</p>}
    </section>
  );
}
