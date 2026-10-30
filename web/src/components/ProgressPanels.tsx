import type { ProgressSummary, Unit } from '../types';
import { toDisplay } from '../lib/training';
import './ProgressPanels.css';
import { calendarWeekLabel, type CalendarWeekSummary } from '../lib/calendarWeekSummary';

export function ProgressStats({ week }: { week: CalendarWeekSummary | null }) {
  const totals = week?.totals;
  return (
    <div className="stats-grid progress-stats" role="region" aria-label="Training statistics">
      <div className="stat-card progress-stat-card">
        <span className="stat-label-text">Workouts</span>
        <div className="stat-card-value">
          <strong>{totals?.sessions.toLocaleString() ?? '—'}</strong>
        </div>
      </div>

      <div className="stat-card progress-stat-card">
        <span className="stat-label-text">Working sets</span>
        <div className="stat-card-value">
          <strong>{totals?.workingSets?.toLocaleString() ?? '—'}</strong>
        </div>
      </div>

      <div className="stat-card progress-stat-card">
        <span className="stat-label-text">Training time</span>
        <div className="stat-card-value">
          <strong>
            {totals?.trainingMinutes != null ? (
              <>
                {totals.trainingMinutes.toLocaleString()}{' '}
                <small className="stat-unit">min</small>
              </>
            ) : (
              '—'
            )}
          </strong>
        </div>
      </div>

      <small className="progress-stats-scope" aria-live="polite">
        {week ? `${calendarWeekLabel(week.from, week.to)} · Completed workouts` : 'Weekly totals'}
      </small>
    </div>
  );
}

export function BodyweightRecords({ progress, unit }: { progress: ProgressSummary | null; unit: Unit }) {
  const records = progress?.exercises.filter(exercise => exercise.bodyweightRepRecord !== null) ?? [];
  if (!records.length) return null;

  return <section className="panel progress-record-panel">
    <div className="section-heading"><h2>Bodyweight records</h2></div>
    {records.map(record => <div className="best-row" key={record.exercise}><span>{record.exercise}</span><strong>{record.bodyweightRepRecord!.reps} reps at {toDisplay(record.bodyweightRepRecord!.bodyweightKg, unit)} {unit} bodyweight</strong></div>)}
  </section>;
}
