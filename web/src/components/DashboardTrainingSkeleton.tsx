import { Skeleton } from './ui/Skeleton';
import './TrainingCalendar.css';
import './TrainingCalendarLayout.css';
import './ProgressPanels.css';

/** Reserve the same responsive calendar and tile structure while their lazy code loads. */
export function CalendarSkeleton() {
  return <section className="panel training-calendar-card" aria-label="Loading training overview" aria-busy="true">
    <div className="calendar-card-header"><div className="calendar-title-wrap">
      <div className="calendar-title-row"><Skeleton className="calendar-icon-badge" /><h3>Activity &amp; Schedule</h3></div>
      <span className="calendar-range-label"><Skeleton style={{ width: 110, height: 17 }} /></span>
    </div></div>
    <div className="calendar-days-grid" aria-hidden="true">{Array.from({ length: 7 }, (_, index) =>
      <div className="calendar-day-cell" key={index}>
        <Skeleton style={{ width: 24, height: 17 }} /><Skeleton style={{ width: 20, height: 20 }} />
        <Skeleton style={{ width: 28, height: 22 }} />
      </div>)}</div>
    <div className="calendar-nav-controls" aria-hidden="true">
      <Skeleton className="calendar-nav-btn" style={{ height: 44 }} /><Skeleton className="calendar-today-btn" style={{ height: 44 }} /><Skeleton className="calendar-nav-btn" style={{ height: 44 }} />
    </div>
    <div className="calendar-card-footer" aria-hidden="true">
      <div className="calendar-week-summary"><Skeleton style={{ width: 220, height: 30 }} /></div>
      <div className="calendar-legend-pills"><Skeleton style={{ width: 190, height: 28 }} /></div>
    </div>
  </section>;
}

export function ProgressStatsSkeleton() {
  return <div className="stats-grid progress-stats" aria-label="Loading training statistics" aria-busy="true">
    {Array.from({ length: 5 }, (_, index) => <div className="stat-card progress-stat-card" key={index} aria-hidden="true">
      <div className="stat-card-header"><Skeleton className="stat-icon-wrap" /><Skeleton style={{ width: 60, height: 18 }} /></div>
      <div className="stat-card-value"><strong>—</strong></div>
    </div>)}
  </div>;
}
