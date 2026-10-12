import { Skeleton } from './ui/Skeleton';
import './TrainingCalendar.css';
import './ProgressPanels.css';

/** Reserve the same responsive calendar and unboxed metric strip structure while lazy code loads. */
export function CalendarSkeleton() {
  return (
    <section className="panel training-calendar-card" aria-label="Loading training overview" aria-busy="true">
      <div className="calendar-card-header" aria-hidden="true">
        <div className="calendar-completion">
          <Skeleton className="weekly-completion-ring" />
          <div className="calendar-title-wrap">
            <Skeleton style={{ width: 140, height: 20 }} />
            <Skeleton style={{ width: 160, height: 16 }} />
          </div>
        </div>
        <div className="calendar-nav-controls">
          <Skeleton style={{ width: 120, height: 36, borderRadius: 'var(--radius-control, 8px)' }} />
        </div>
      </div>
      <div className="calendar-week-row" aria-hidden="true">
        <div className="calendar-week-rail">
          <div className="calendar-days-grid">
            {Array.from({ length: 7 }, (_, index) => (
              <div className="calendar-day-cell" key={index}>
                <Skeleton style={{ width: 24, height: 16 }} />
                <Skeleton style={{ width: 32, height: 32, borderRadius: '50%' }} />
                <Skeleton style={{ width: 14, height: 14 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="calendar-card-footer" aria-hidden="true">
        <Skeleton style={{ width: 180, height: 16 }} />
      </div>
    </section>
  );
}

export function ProgressStatsSkeleton() {
  return (
    <div className="stats-grid progress-stats" aria-label="Loading training statistics" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="stat-card progress-stat-card" key={index} aria-hidden="true">
          <Skeleton style={{ width: 72, height: 16 }} />
          <div className="stat-card-value">
            <Skeleton style={{ width: 44, height: 26 }} />
          </div>
        </div>
      ))}
      <small className="progress-stats-scope" aria-hidden="true"><Skeleton style={{ width: 96, height: 14 }} /></small>
    </div>
  );
}
