import { Skeleton } from './ui/Skeleton';

/// Placeholders for the workout history, drawn with the real history classes (History.css is
/// critical CSS, so it is already loaded and this file needs no import of its own, which also keeps
/// it usable in the boot shell). Reusing the classes keeps each placeholder the size of its real
/// counterpart, so nothing moves when the workouts arrive.

/** Overview's Recent workouts: the bare section title, then the newest workouts as cards. */
export function RecentWorkoutsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <section className="panel history-recent history-recent-loading" aria-label="Loading recent workouts" aria-busy="true">
      <div className="section-heading" aria-hidden="true"><h2>Recent workouts</h2></div>
      <div className="history-list" aria-hidden="true">
        <div className="history-month">
          {Array.from({ length: count }, (_, index) => (
            <div className="history-item-wrap history-card-skeleton" key={index}>
              <div className="history-row">
                <Skeleton className="history-date-skeleton" />
                <div className="row-title">
                  <Skeleton className="history-title-skeleton" />
                  {/* Chips the width of the real figures, so the line wraps where the real one does. */}
                  <div className="history-stats">
                    {[0, 1, 2].map(chip => <Skeleton key={chip} className="history-stat-chip" />)}
                  </div>
                </div>
              </div>
              {/* The actions button is invisible until hovered but still takes its column. */}
              <span className="history-menu-trigger history-menu-spacer" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The full history list (the All history sheet and a first load): a month heading, then rows. */
export function HistoryRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="history-loading-list" aria-label="Loading workout history" aria-busy="true">
      <Skeleton className="history-month-skeleton" aria-hidden="true" />
      {Array.from({ length: rows }, (_, index) => (
        <div className="history-row-skeleton-shape" key={index} aria-hidden="true">
          <Skeleton className="history-date-skeleton" />
          <div className="history-row-skeleton-lines">
            <Skeleton className="history-title-skeleton" />
            <Skeleton className="history-stats-skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}
