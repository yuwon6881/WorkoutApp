import { Skeleton } from './ui/Skeleton';
import { OverviewLoadingContent } from './OverviewLoadingContent';

const NAV_ITEMS = 4;

/// The first load draws the real shell (navigation, top bar) around the shape of the Overview it
/// is about to show, reserving its columns and controls before the account state is known.
export function AppLoading() {
  return (
    <div className="app-shell app-loading-shell" aria-busy="true">
      <aside className="sidebar" aria-hidden="true">
        <div className="brand"><img src="/favicon.svg" alt="" /><span>Workout</span></div>
        <div className="app-loading-action">
          <Skeleton className="skeleton-action-button" />
        </div>
        <div className="app-loading-nav">
          {Array.from({ length: NAV_ITEMS }, (_, index) => <Skeleton key={index} className="skeleton-nav-item" />)}
        </div>
        <div className="sidebar-bottom app-loading-nav-bottom">
          <Skeleton className="skeleton-nav-item" />
          <Skeleton className="skeleton-nav-item" />
          <div className="skeleton-account-card">
            <Skeleton className="skeleton-account-avatar" />
            <div className="skeleton-account-text">
              <Skeleton className="skeleton-account-name" />
              <Skeleton className="skeleton-account-desc" />
            </div>
          </div>
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
          <OverviewLoadingContent />
        </main>
      </div>

      <nav className="bottom-nav" aria-hidden="true">
        <div className="bottom-nav-track app-loading-bottom-nav">
          {Array.from({ length: NAV_ITEMS + 1 }, (_, index) => <Skeleton key={index}
            className={index === NAV_ITEMS / 2 ? 'skeleton-bottom-action' : 'skeleton-bottom-item'} />)}
        </div>
      </nav>
    </div>
  );
}
