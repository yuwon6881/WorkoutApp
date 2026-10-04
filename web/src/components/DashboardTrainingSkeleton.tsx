import { Skeleton } from './ui/Skeleton';
import { useWindowTier } from '../lib/breakpoints';
import './TrainingCalendar.css';
import './ProgressPanels.css';

/** Reserve the same responsive calendar and tile structure while their lazy code loads. Phones show
 *  the program week as its own card above the calendar, so the skeleton does too. */
export function CalendarSkeleton() {
  const compact = useWindowTier() === 'compact';
  return <>
    {compact && <section className="panel program-week-card" aria-hidden="true">
      <Skeleton style={{ width: 140, height: 22 }} />
      <Skeleton className="weekly-completion-ring" style={{ borderRadius: '50%' }} />
      <Skeleton style={{ width: 190, height: 20 }} />
      <Skeleton style={{ width: 120, height: 18 }} />
    </section>}
    <section className="panel training-calendar-card" aria-label="Loading training overview" aria-busy="true">
      <div className="calendar-card-header" aria-hidden="true">
        {compact ? <div className="calendar-nav-controls"><Skeleton style={{ width: 120, height: 20 }} /></div>
          : <div className="calendar-completion"><Skeleton className="weekly-completion-ring" />
            <div className="calendar-title-wrap"><Skeleton style={{ width: 140, height: 20 }} />
              <Skeleton style={{ width: 110, height: 17 }} /><Skeleton style={{ width: 130, height: 17 }} /></div>
          </div>}
      </div>
      <div className="calendar-week-row" aria-hidden="true"><div className="calendar-week-rail">
        <div className="calendar-days-grid">{Array.from({ length: 7 }, (_, index) =>
          <div className="calendar-day-cell" key={index}><Skeleton style={{ width: 24, height: 17 }} />
            <Skeleton style={{ width: 32, height: 32, borderRadius: '50%' }} /><Skeleton style={{ width: 16, height: 16 }} /></div>)}</div>
      </div></div>
      <div className="calendar-card-footer" aria-hidden="true"><Skeleton style={{ width: 180, height: 17 }} /></div>
    </section>
  </>;
}

export function ProgressStatsSkeleton() {
  return <div className="stats-grid progress-stats" aria-label="Loading training statistics" aria-busy="true">
    {Array.from({ length: 3 }, (_, index) => <div className="stat-card progress-stat-card" key={index} aria-hidden="true">
      <div className="stat-card-header"><Skeleton className="stat-icon-wrap" /><Skeleton style={{ width: 60, height: 18 }} /></div>
      <div className="stat-card-value"><strong>—</strong></div>
    </div>)}
  </div>;
}
