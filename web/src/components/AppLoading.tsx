import { Skeleton } from './ui/Skeleton';

const NAV_ITEMS = 4;
const WEEK_DAYS = 7;
const STATS = 3;

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
          <div className="topbar-actions">
            <Skeleton className="skeleton-topbar-action skeleton-topbar-ai" />
            <Skeleton className="skeleton-topbar-action" />
          </div>
        </header>

        <main className="app-loading" role="status">
          <span className="sr-only">Loading your training. Your workouts live on the server, so this needs a connection.</span>
          <div className="page-heading dashboard-heading" aria-hidden="true">
            <div>
              <Skeleton className="skeleton-title" />
              <Skeleton className="skeleton-subtitle" />
            </div>
          </div>

          <section className="panel app-loading-quick-start" aria-hidden="true">
            <div>
              <Skeleton className="skeleton-pill" />
              <Skeleton className="skeleton-hero-line" />
            </div>
            <Skeleton className="skeleton-hero-button" />
          </section>

          <section className="panel app-loading-program-week" aria-hidden="true">
            <Skeleton className="skeleton-section-title" />
            <Skeleton className="skeleton-week-ring" />
            <Skeleton className="skeleton-subtitle" />
          </section>

          <section className="panel training-calendar-card" aria-hidden="true">
            <div className="app-loading-week-summary">
              <Skeleton className="skeleton-week-ring" />
              <div><Skeleton className="skeleton-section-title" /><Skeleton className="skeleton-subtitle" /></div>
            </div>
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
