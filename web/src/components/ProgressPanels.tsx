import type { ProgressSummary, Unit } from '../types';
import { toDisplay } from '../lib/training';
import './ProgressPanels.css';
import { calendarWeekLabel, type CalendarWeekSummary } from '../lib/calendarWeekSummary';

/// One weekly total: its value, then a short label that fits one line in the narrowest tile.
/// Sets are working sets and time excludes pauses, as everywhere else in the app.
function WeekStat({ label, value, unit }: { label: string; value: string | null; unit?: string }) {
  return (
    <div className="stat-card progress-stat-card">
      <span className="stat-label-text">{label}</span>
      <div className="stat-card-value">
        <strong>
          {value ?? '—'}
          {value !== null && unit && <>{' '}<small className="stat-unit">{unit}</small></>}
        </strong>
      </div>
    </div>
  );
}

export function ProgressStats({ week }: { week: CalendarWeekSummary | null }) {
  const totals = week?.totals;
  return (
    <div className="stats-grid progress-stats" role="region" aria-label="Training statistics">
      <WeekStat label="Workouts" value={totals?.sessions.toLocaleString() ?? null} />
      <WeekStat label="Sets" value={totals?.workingSets?.toLocaleString() ?? null} />
      <WeekStat label="Time" value={totals?.trainingMinutes?.toLocaleString() ?? null} unit="min" />
      {/* The calendar header shows the range; this keeps it with the totals for screen readers. */}
      <small className="sr-only" aria-live="polite">
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
