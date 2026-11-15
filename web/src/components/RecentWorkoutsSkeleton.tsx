import { Skeleton } from './ui/Skeleton';

/// Placeholders for the workout history. The Overview's cards carry their own `recent-skeleton-*`
/// classes, styled in skeletons.css, because the boot shell paints before History.css has loaded and
/// this must look the same in every frame of a load. A test compares it with the real cards.

/** Overview's Recent workouts: the bare section title, then the newest workouts as cards. */
export function RecentWorkoutsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <section className="recent-skeleton" aria-label="Loading recent workouts" aria-busy="true">
      <div className="section-heading" aria-hidden="true"><h2>Recent workouts</h2></div>
      <div className="recent-skeleton-grid" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div className="recent-skeleton-card" key={index}>
            <div className="recent-skeleton-row">
              <Skeleton className="recent-skeleton-date" />
              <div className="recent-skeleton-text">
                <Skeleton className="recent-skeleton-title" />
                {/* Chips the width of the real figures, so the line wraps where the real one does. */}
                <div className="recent-skeleton-stats">
                  {[0, 1, 2].map(chip => <Skeleton key={chip} className="recent-skeleton-chip" />)}
                </div>
              </div>
            </div>
            {/* The actions button is invisible until hovered but still takes its column. */}
            <span className="recent-skeleton-menu" />
          </div>
        ))}
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
