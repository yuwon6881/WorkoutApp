import { Skeleton } from './ui/Skeleton';

/// The first load draws the shape of the Overview it is about to show, so the page settles into
/// place instead of swapping a centred card for a full layout.
export function AppLoading() {
  return (
    <div className="app-loading" role="status">
      <span className="sr-only">Loading your training. Your workouts live on the server, so this needs a connection.</span>
      <Skeleton className="skeleton-title" aria-hidden="true" />
      <Skeleton className="skeleton-subtitle" aria-hidden="true" />
      <Skeleton className="skeleton-hero" aria-hidden="true" />
      <Skeleton className="skeleton-week" aria-hidden="true" />
      <div className="skeleton-stats" aria-hidden="true">
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}
