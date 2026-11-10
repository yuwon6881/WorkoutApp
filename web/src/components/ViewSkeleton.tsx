import { Skeleton } from './ui/Skeleton';
import type { Tab } from '../app/useTabNavigation';
import './ViewSkeleton.css';

/// Drawn while a view's code arrives the first time it is opened: mirrors the route's real initial
/// structure and responsive regions so layout shift stays minimal when real content replaces it.
export function ViewSkeleton({ label, view = 'overview' }: { label: string; view?: Tab }) {
  return (
    <div className={`view-skeleton view-skeleton-${view}`} role="status" aria-label={`Loading ${label}`}>
      {view === 'import' ? (
        <div className="page-heading" aria-hidden="true">
          <div className="view-skeleton-import-head">
            <Skeleton className="view-skeleton-back" />
            <Skeleton className="skeleton-title" />
          </div>
        </div>
      ) : (
        <div className="page-heading" aria-hidden="true">
          <Skeleton className="skeleton-title" />
          {(view === 'exercises' || view === 'program') && (
            <Skeleton className={`view-skeleton-action${view === 'program' ? ' compact' : ''}`} />
          )}
        </div>
      )}

      {view === 'exercises' && (
        <>
          <div className="view-skeleton-filters" aria-hidden="true">
            <Skeleton className="view-skeleton-search" />
            <div className="view-skeleton-minor-filters">
              <Skeleton className="view-skeleton-filter" />
              <Skeleton className="view-skeleton-filter" />
            </div>
          </div>
          <div className="view-skeleton-chips" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="view-skeleton-chip" />)}
          </div>
          <Skeleton className="view-skeleton-section-title" aria-hidden="true" />
          <div className="view-skeleton-cards" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="skeleton-panel view-skeleton-exercise" />)}
          </div>
        </>
      )}

      {view === 'body' && (
        <div className="view-skeleton-muscle-grid" aria-hidden="true">
          <Skeleton className="view-skeleton-map" />
          <div>
            <Skeleton className="skeleton-panel" />
            <Skeleton className="skeleton-panel tall" />
          </div>
        </div>
      )}

      {view === 'program' && (
        <>
          <div className="view-skeleton-program-section" aria-hidden="true">
            <Skeleton className="view-skeleton-section-title" />
            <Skeleton className="skeleton-panel view-skeleton-slot" />
          </div>
          <div className="view-skeleton-program-section" aria-hidden="true">
            <Skeleton className="view-skeleton-section-title" />
            <div className="view-skeleton-cards">
              {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="skeleton-panel view-skeleton-library-card" />)}
            </div>
          </div>
        </>
      )}

      {view === 'import' && (
        <div className="view-skeleton-sections" aria-hidden="true">
          <Skeleton className="skeleton-panel view-skeleton-upload" />
          <Skeleton className="skeleton-panel view-skeleton-external" />
        </div>
      )}

      {view === 'settings' && (
        <>
          <Skeleton className="skeleton-panel view-skeleton-account" aria-hidden="true" />
          <div className="view-skeleton-settings-shell" aria-hidden="true">
            <div className="view-skeleton-settings-nav">
              {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="view-skeleton-settings-pill" />)}
            </div>
            <div className="view-skeleton-sections">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="view-skeleton-settings-group">
                  <Skeleton className="view-skeleton-section-title" />
                  <Skeleton className="skeleton-panel view-skeleton-settings-card" />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {view === 'overview' && (
        <>
          <Skeleton className="skeleton-panel tall" aria-hidden="true" />
          <div className="view-skeleton-sections" aria-hidden="true">
            <Skeleton className="skeleton-panel" />
            <Skeleton className="skeleton-panel" />
          </div>
        </>
      )}
    </div>
  );
}
