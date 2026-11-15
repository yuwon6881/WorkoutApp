import { Skeleton } from './ui/Skeleton';
import { RecentWorkoutsSkeleton } from './RecentWorkoutsSkeleton';

const WEEK_DAYS = 7;
const STATS = 3;

/// Everything the Overview shows before its data arrives. The boot shell and the lazy view's
/// placeholder both draw exactly this (inside an `.app-loading` element), so the first frame and the
/// frame after it are identical and only the finished page differs. It carries no CSS import: the
/// boot shell is rendered at build time and paints before any feature stylesheet has loaded, so its
/// shapes live in layout.css and skeletons.css.
export function OverviewLoadingContent() {
  return (
    <>
      <div className="page-heading dashboard-heading" aria-hidden="true">
        <div>
          <Skeleton className="skeleton-title" />
          <Skeleton className="skeleton-subtitle" />
        </div>
      </div>

      <div className="overview-hero-calendar-grid">
        <div className="overview-main-column">
          <section className="panel app-loading-quick-start" aria-hidden="true">
            <div>
              <Skeleton className="skeleton-pill" />
              <Skeleton className="skeleton-hero-title" />
              <Skeleton className="skeleton-hero-line" />
            </div>
            <Skeleton className="skeleton-hero-button" />
          </section>
        </div>

        <div className="overview-calendar-column">
          <section className="panel training-calendar-card" aria-hidden="true">
            <div className="app-loading-week-summary">
              <Skeleton className="skeleton-week-ring" />
              <div><Skeleton className="skeleton-section-title" /><Skeleton className="skeleton-subtitle" /></div>
            </div>
            <div className="calendar-days-grid app-loading-week">
              {Array.from({ length: WEEK_DAYS }, (_, index) => <Skeleton key={index} className="skeleton-day" />)}
            </div>
            <div className="stats-grid progress-stats" aria-hidden="true">
              {Array.from({ length: STATS }, (_, index) => <Skeleton key={index} className="skeleton-stat" />)}
            </div>
          </section>
        </div>
      </div>

      <RecentWorkoutsSkeleton />
    </>
  );
}
