import { ArrowRight, BarChart3, CalendarDays, Dumbbell, Trophy } from 'lucide-react';
import type { ProgressSummary, Unit } from '../types';
import { showVolume, showWeight, toDisplay } from '../lib/training';
import { Button } from './ui/Button';
import './ProgressPanels.css';

export function ProgressStats({ progress, unit }: { progress: ProgressSummary | null; unit: Unit }) {
  return <div className="stats-grid progress-stats">
    <div className="stat-card"><div className="stat-label"><CalendarDays size={17} />Workouts</div><strong>{progress?.sessions ?? '—'}</strong></div>
    <div className="stat-card"><div className="stat-label"><CalendarDays size={17} />This week</div><strong>{progress?.weekSessions ?? '—'}</strong></div>
    <div className="stat-card"><div className="stat-label"><BarChart3 size={17} />Weekly volume</div><strong>{showVolume(progress?.weekVolumeKg ?? null, unit)}</strong></div>
    <div className="stat-card"><div className="stat-label"><Dumbbell size={17} />Working sets</div><strong>{progress?.workingSets ?? '—'}</strong></div>
    <div className="stat-card"><div className="stat-label"><Dumbbell size={17} />Training time</div><strong>{progress?.trainingMinutes ?? '—'}<small> min</small></strong></div>
  </div>;
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
    <p className="muted">Bodyweight records keep the bodyweight context captured with each set.</p>
    {records.map(record => <div className="best-row" key={record.exercise}><span>{record.exercise}</span><strong>{record.bodyweightRepRecord!.reps} reps at {toDisplay(record.bodyweightRepRecord!.bodyweightKg, unit)} {unit} bodyweight</strong></div>)}
  </section>;
}
