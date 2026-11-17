import { Skeleton } from './ui/Skeleton';

const WEEK_DAYS = 7;
const STATS = 3;

/// The calendar card before its data or code arrives: the ring and title, the week range, the seven
/// days in their sunken strip, the three totals and the legend line. The boot shell, the lazy Overview's
/// placeholder and the calendar's own Suspense fallback all draw this one component, so a reload never
/// shows a different card depending on which frame happens to paint.
///
/// It carries no CSS import and uses only `calendar-skeleton`/`cal-sk-*` classes (skeletons.css). The
/// real card's classes (`.calendar-days-grid`, `.training-calendar-card`, ...) come from a lazy
/// stylesheet that can land while this is still on screen, and some of them, `flex: 0 0 100%` on the
/// day grid, stretch a placeholder to the whole card. Keeping the two vocabularies apart makes that
/// impossible. Pass `label` where nothing else announces the loading state.
export function CalendarCardSkeleton({ label }: { label?: string }) {
  const announce = label ? { role: 'status', 'aria-label': label, 'aria-busy': true } : { 'aria-hidden': true };
  return (
    <section className="panel calendar-skeleton is-placeholder" {...announce}>
      <div className="cal-sk-head" aria-hidden="true">
        <Skeleton className="cal-sk-ring" />
        <div className="cal-sk-title">
          <Skeleton className="cal-sk-title-line" />
          <Skeleton className="cal-sk-subtitle-line" />
        </div>
        <Skeleton className="cal-sk-range" />
      </div>
      <div className="cal-sk-week" aria-hidden="true">
        {Array.from({ length: WEEK_DAYS }, (_, index) => (
          <div className="cal-sk-day" key={index}>
            <Skeleton className="cal-sk-weekday" />
            <Skeleton className="cal-sk-date" />
            <Skeleton className="cal-sk-status" />
          </div>
        ))}
      </div>
      <div className="cal-sk-stats" aria-hidden="true">
        {Array.from({ length: STATS }, (_, index) => <Skeleton key={index} className="skeleton-stat" />)}
      </div>
      <Skeleton className="cal-sk-legend" aria-hidden="true" />
    </section>
  );
}
