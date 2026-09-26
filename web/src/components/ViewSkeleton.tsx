import { Skeleton } from './ui/Skeleton';

/// Drawn while a view's code arrives the first time it is opened: a page heading and the panels
/// every view starts with, so the page does not jump when the real content replaces it.
export function ViewSkeleton({ label }: { label: string }) {
  return (
    <div className="view-skeleton" role="status" aria-label={`Loading ${label}`}>
      <div className="page-heading" aria-hidden="true"><Skeleton className="skeleton-title" /></div>
      <Skeleton className="skeleton-panel tall" aria-hidden="true" />
      <Skeleton className="skeleton-panel" aria-hidden="true" />
      <Skeleton className="skeleton-panel" aria-hidden="true" />
    </div>
  );
}
