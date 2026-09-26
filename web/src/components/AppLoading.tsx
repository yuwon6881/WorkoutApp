import { Skeleton } from './ui/Skeleton';

const NAV_ITEMS = 4;
const WEEK_DAYS = 7;
const STATS = 4;

/// The first load draws the real shell (navigation, top bar) around the shape of the Overview it
/// is about to show, using the same layout classes. When the data arrives nothing moves: the
/// placeholders are replaced in place instead of a floating stack giving way to a whole page.
export function AppLoading() {
  return (
    <div className="app-shell app-loading-shell" aria-busy="true">
      <aside className="sidebar" aria-hidden="true">
        <div className="brand"><img src="/favicon.svg" alt="" /><span>Workout</span></div>
        <div className="app-loading-nav">
          {Array.from({ length: NAV_ITEMS }, (_, index) => <Skeleton key={index} className="skeleton-nav-item" />)}
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar" aria-hidden="true">
          <div className="brand mobile-brand"><img src="/favicon.svg" alt="" />Workout</div>
          <Skeleton className="skeleton-topbar-action" />
        </header>

        <main className="app-loading" role="status">
          <span className="sr-only">Loading your training. Your workouts live on the server, so this needs a connection.</span>
          <div className="page-heading dashboard-heading" aria-hidden="true">
            <div>
              <Skeleton className="skeleton-title" />
              <Skeleton className="skeleton-subtitle" />
            </div>
          </div>

          <section className="next-workout quick-start-hero app-loading-hero" aria-hidden="true">
            <div className="hero-top">
              <Skeleton className="skeleton-pill" />
              <Skeleton className="skeleton-pill short" />
            </div>
            <Skeleton className="skeleton-hero-title" />
            <Skeleton className="skeleton-hero-line" />
            <Skeleton className="skeleton-hero-button" />
          </section>

          <section className="panel training-calendar-card" aria-hidden="true">
            <Skeleton className="skeleton-section-title" />
            <div className="calendar-days-grid app-loading-week">
              {Array.from({ length: WEEK_DAYS }, (_, index) => <Skeleton key={index} className="skeleton-day" />)}
            </div>
          </section>

          <div className="stats-grid progress-stats" aria-hidden="true">
            {Array.from({ length: STATS }, (_, index) => <Skeleton key={index} className="skeleton-stat" />)}
          </div>
        </main>
      </div>

      <nav className="bottom-nav" aria-hidden="true">
        <div className="bottom-nav-track app-loading-bottom-nav">
          {Array.from({ length: NAV_ITEMS }, (_, index) => <Skeleton key={index} className="skeleton-bottom-item" />)}
        </div>
      </nav>
    </div>
  );
}
