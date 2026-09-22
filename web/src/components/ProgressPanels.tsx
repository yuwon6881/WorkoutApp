import { ArrowRight, CalendarDays, Clock, Dumbbell, TrendingUp, Trophy } from 'lucide-react';
import type { ProgressSummary, Unit } from '../types';
import { showVolume, showWeight, toDisplay } from '../lib/training';
import { Button } from './ui/Button';
import './ProgressPanels.css';

export function ProgressStats({ progress, unit }: { progress: ProgressSummary | null; unit: Unit }) {
  return (
    <div className="stats-grid progress-stats" role="region" aria-label="Training statistics">
      <div className="stat-card progress-stat-card">
        <div className="stat-card-header">
          <span className="stat-icon-wrap"><Trophy size={16} aria-hidden="true" /></span>
          <span className="stat-label-text">Workouts</span>
        </div>
        <div className="stat-card-value">
          <strong>{progress?.sessions ? progress.sessions.toLocaleString() : '—'}</strong>
        </div>
      </div>

      <div className="stat-card progress-stat-card highlight">
        <div className="stat-card-header">
          <span className="stat-icon-wrap accent"><CalendarDays size={16} aria-hidden="true" /></span>
          <span className="stat-label-text">This week</span>
        </div>
        <div className="stat-card-value">
          <strong>{progress?.weekSessions ? progress.weekSessions.toLocaleString() : '—'}</strong>
          {progress?.weekSessions ? <span className="stat-subtext">workouts</span> : null}
        </div>
      </div>

      <div className="stat-card progress-stat-card highlight">
        <div className="stat-card-header">
          <span className="stat-icon-wrap accent"><TrendingUp size={16} aria-hidden="true" /></span>
          <span className="stat-label-text">Weekly volume</span>
        </div>
        <div className="stat-card-value">
          <strong>{progress?.weekVolumeKg ? showVolume(progress.weekVolumeKg, unit) : '—'}</strong>
        </div>
      </div>

      <div className="stat-card progress-stat-card">
        <div className="stat-card-header">
          <span className="stat-icon-wrap"><Dumbbell size={16} aria-hidden="true" /></span>
          <span className="stat-label-text">Working sets</span>
        </div>
        <div className="stat-card-value">
          <strong>{progress?.workingSets ? progress.workingSets.toLocaleString() : '—'}</strong>
        </div>
      </div>

      <div className="stat-card progress-stat-card">
        <div className="stat-card-header">
          <span className="stat-icon-wrap"><Clock size={16} aria-hidden="true" /></span>
          <span className="stat-label-text">Training time</span>
        </div>
        <div className="stat-card-value">
          <strong>
            {progress?.trainingMinutes ? (
              <>
                {progress.trainingMinutes.toLocaleString()}{' '}
                <small className="stat-unit">min</small>
              </>
            ) : (
              '—'
            )}
          </strong>
        </div>
      </div>
    </div>
  );
}

export function PersonalBests({ progress, error, onRetry, onExercise, unit }: {
  progress: ProgressSummary | null; error: string; onRetry: () => void; onExercise?: (id: string) => void; unit: Unit;
}) {
  const bests = progress?.exercises
    .map(exercise => ({
      ...exercise,
      value: exercise.estimatedMaxKg ?? exercise.externalLoadPrKg ?? exercise.addedLoadPrKg ?? exercise.systemLoadPrKg ?? exercise.assistanceReductionPrKg
    }))
    .filter(exercise => exercise.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) ?? [];

  return <section className="panel progress-record-panel" aria-live="polite">
    <div className="section-heading"><h2>Personal bests</h2><Trophy size={18} className="accent" /></div>
    {!progress && !error && <div className="skeleton progress-section-skeleton" aria-label="Loading personal bests" />}
    {error && <div className="error-banner" role="alert"><span>{error}</span><Button variant="tertiary" onClick={onRetry}>Retry</Button></div>}
    {progress && (bests.length ? bests.slice(0, 6).map(record => record.exerciseId && onExercise
      ? <Button variant="tertiary" className="best-row best-row-action" key={record.exercise} onClick={() => onExercise(record.exerciseId!)} aria-label={`Open ${record.exercise} exercise details`}><span>{record.exercise}</span><strong>{showWeight(record.value ?? null, unit)}</strong><ArrowRight size={15} /></Button>
      : <div className="best-row" key={record.exercise}><span>{record.exercise}</span><strong>{showWeight(record.value ?? null, unit)}</strong></div>)
      : <div className="empty-message"><Trophy size={30} /><p>No personal bests yet. Log a workout to record one.</p></div>)}
  </section>;
}

export function BodyweightRecords({ progress, unit }: { progress: ProgressSummary | null; unit: Unit }) {
  const records = progress?.exercises.filter(exercise => exercise.bodyweightRepRecord !== null) ?? [];
  if (!records.length) return null;

  return <section className="panel progress-record-panel">
    <div className="section-heading"><h2>Bodyweight records</h2><Trophy size={18} className="accent" /></div>
    {records.map(record => <div className="best-row" key={record.exercise}><span>{record.exercise}</span><strong>{record.bodyweightRepRecord!.reps} reps at {toDisplay(record.bodyweightRepRecord!.bodyweightKg, unit)} {unit} bodyweight</strong></div>)}
  </section>;
}
