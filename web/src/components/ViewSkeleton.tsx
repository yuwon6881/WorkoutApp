import { Skeleton } from './ui/Skeleton';
import type { Tab } from '../app/useTabNavigation';
import './ViewSkeleton.css';

/// Drawn while a view's code arrives the first time it is opened: a page heading and the panels
/// every view starts with, so the page does not jump when the real content replaces it.
export function ViewSkeleton({ label, view = 'overview' }: { label: string; view?: Tab }) {
  const library = view === 'exercises';
  const cards = view === 'program' || library;
  return (
    <div className={`view-skeleton view-skeleton-${view}`} role="status" aria-label={`Loading ${label}`}>
      <div className="page-heading" aria-hidden="true"><Skeleton className="skeleton-title" /></div>
      {library && <div className="view-skeleton-filters" aria-hidden="true">
        <Skeleton className="view-skeleton-search" /><Skeleton className="view-skeleton-filter" />
      </div>}
      {view === 'body' ? <div className="view-skeleton-muscle-grid" aria-hidden="true">
        <Skeleton className="view-skeleton-map" /><div><Skeleton className="skeleton-panel" /><Skeleton className="skeleton-panel tall" /></div>
      </div> : <>
        {!library && <Skeleton className={`skeleton-panel ${view === 'program' || view === 'import' ? 'view-skeleton-slot' : 'tall'}`} aria-hidden="true" />}
        <div className={cards ? 'view-skeleton-cards' : 'view-skeleton-sections'} aria-hidden="true">
          {Array.from({ length: library ? 6 : view === 'settings' ? 3 : 2 }, (_, index) =>
            <Skeleton key={index} className={`skeleton-panel${library ? ' view-skeleton-exercise' : ''}`} />)}
        </div>
      </>}
    </div>
  );
}
