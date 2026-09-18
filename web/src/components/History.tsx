import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, CalendarDays, Dumbbell, Trophy } from 'lucide-react';
import type { Exercise, HistoryPage, Preferences, ProgressSummary, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { getWorkoutMuscles } from '../lib/muscles';
import { completedSets, duration, showRpe, showVolume, showWeight, toDisplay } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

let progressCache: ProgressSummary | null = null;
let historyCache: HistoryPage | null = null;
export function clearHistoryViewCache() { progressCache = null; historyCache = null; }

function isSameHistory(a: HistoryPage, b: HistoryPage): boolean {
  if (a.total !== b.total || a.page !== b.page || a.sessions.length !== b.sessions.length) return false;
  for (let i = 0; i < a.sessions.length; i++) {
    const s1 = a.sessions[i];
    const s2 = b.sessions[i];
    if (s1.id !== s2.id || s1.startedAt !== s2.startedAt || s1.finishedAt !== s2.finishedAt || s1.completedSets !== s2.completedSets || s1.volumeKg !== s2.volumeKg) {
      return false;
    }
  }
  return true;
}

export function HistoryView({ initial, initialProgress, preferences, onSession, onStart, onExercise }: {
  initial: HistoryPage; initialProgress?: ProgressSummary; preferences: Preferences; onSession: (s: Session) => void; onStart: () => void; onExercise?: (id: string) => void;
}) {
  if (!historyCache && initial) historyCache = initial;
  if (!progressCache && initialProgress) progressCache = initialProgress;

  const [page, setPage] = useState<HistoryPage>(historyCache ?? initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ProgressSummary | null>(progressCache ?? initialProgress ?? null);
  const [progressError, setProgressError] = useState('');
  const [progressRetry, setProgressRetry] = useState(0);
  const unit = preferences.unit;

  useEffect(() => {
    if (initial) {
      historyCache = initial;
      setPage(current => isSameHistory(current, initial) ? current : initial);
    }
  }, [initial]);

  useEffect(() => {
    if (initialProgress) {
      progressCache = initialProgress;
      setProgress(initialProgress);
    }
  }, [initialProgress]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    api.history(0, 20, controller.signal)
      .then(next => {
        if (!cancelled) {
          historyCache = next;
          setPage(current => isSameHistory(current, next) ? current : next);
          setError('');
        }
      })
      .catch(failure => {
        if (!cancelled && !page.sessions.length && !error) {
          setError(failure instanceof ApiError ? failure.message : 'Could not load your history.');
        }
      });
    api.refreshNutritionContext(controller.signal).catch(() => { /* progression context is optional */ });
    return () => { cancelled = true; controller.abort(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setProgressError('');
    api.progress(controller.signal)
      .then(next => { if (!cancelled) { progressCache = next; setProgress(next); } })
      .catch(failure => { if (!cancelled && !progress) setProgressError(failure instanceof ApiError ? failure.message : 'Progress records could not be loaded.'); });
    return () => { cancelled = true; controller.abort(); };
  }, [progressRetry]);

  async function more() {
    setLoading(true);
    try {
      const next = await api.history(page.page + 1, page.size);
      const merged = { ...next, sessions: [...page.sessions, ...next.sessions] };
      historyCache = merged;
      setPage(merged);
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load more history.'); }
    finally { setLoading(false); }
  }

  const sessions = page.sessions;
  const bodyweightRecords = progress?.exercises.filter(exercise => exercise.bodyweightRepRecord !== null) ?? [];
  const bests = progress?.exercises
    .map(exercise => ({
      ...exercise,
      value: exercise.estimatedMaxKg ?? exercise.externalLoadPrKg ?? exercise.addedLoadPrKg ?? exercise.systemLoadPrKg ?? exercise.assistanceReductionPrKg
    }))
    .filter(exercise => exercise.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) ?? [];

  return <>
    <div className="page-heading">
      <h1>Progress</h1>
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="panel">
      <div className="section-heading"><h2>Workout history</h2><span className="muted">{sessions.length} of {page.total}</span></div>
      {sessions.map(session => <Button className="history-row" variant="tertiary" key={session.id} onClick={() => onSession(session)}>
        <span className="exercise-icon"><Dumbbell size={20} /></span>
        <span className="row-title"><strong>{session.name}</strong>
          <small>{new Date(session.startedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })} · {duration(session)} min · {session.completedSets} sets</small></span>
        <span>{showVolume(session.volumeKg, unit)}</span>
        <ArrowRight size={16} />
      </Button>)}
      {loading && !sessions.length && <div className="history-loading-list" aria-label="Loading workout history">{[0, 1, 2].map(row => <div className="skeleton history-row-skeleton" key={row} />)}</div>}
      {!sessions.length && !loading && <div className="empty-message"><Dumbbell size={32} /><h3>No workouts yet</h3>
        <p>Finish a workout to see its sets and volume here.</p>
        <Button onClick={onStart}>Find a workout<ArrowRight size={16} /></Button></div>}
      {sessions.length < page.total && <Button className="full-width" disabled={loading} onClick={more}>{loading ? 'Loading…' : 'Load more'}</Button>}
    </section>

    <div className="stats-grid progress-stats">
      <div className="stat-card"><div className="stat-label"><CalendarDays size={17} />Workouts</div><strong>{progress?.sessions ?? '—'}</strong></div>
      <div className="stat-card"><div className="stat-label"><CalendarDays size={17} />This week</div><strong>{progress?.weekSessions ?? '—'}</strong></div>
      <div className="stat-card"><div className="stat-label"><BarChart3 size={17} />Weekly volume</div><strong>{showVolume(progress?.weekVolumeKg ?? null, unit)}</strong></div>
      <div className="stat-card"><div className="stat-label"><Dumbbell size={17} />Working sets</div><strong>{progress?.workingSets ?? '—'}</strong></div>
      <div className="stat-card"><div className="stat-label"><Dumbbell size={17} />Training time</div><strong>{progress?.trainingMinutes ?? '—'}<small> min</small></strong></div>
    </div>

    <section className="panel progress-optional-section" aria-live="polite">
      {!progress && !progressError && <div className="skeleton progress-section-skeleton" aria-label="Loading progress records" />}
      {progressError && <div className="error-banner" role="alert"><span>{progressError}</span><Button variant="tertiary" onClick={() => setProgressRetry(value => value + 1)}>Retry</Button></div>}
      {progress && <>
        <div className="section-heading"><h2>Personal bests</h2><Trophy size={18} className="accent" /></div>
        {bests.length ? bests.slice(0, 6).map(record => record.exerciseId && onExercise
          ? <Button variant="tertiary" className="best-row best-row-action" key={record.exercise} onClick={() => onExercise(record.exerciseId!)} aria-label={`Open ${record.exercise} exercise details`}><span>{record.exercise}</span><strong>{showWeight(record.value ?? null, unit)}</strong><ArrowRight size={15} /></Button>
          : <div className="best-row" key={record.exercise}><span>{record.exercise}</span><strong>{showWeight(record.value ?? null, unit)}</strong></div>)
          : <div className="empty-message"><Trophy size={30} /><p>No personal bests yet. Log a workout to record one.</p></div>}
      </>}
      {progress && bodyweightRecords.length > 0 && <>
        <div className="section-heading"><h2>Bodyweight records</h2><Trophy size={18} className="accent" /></div>
        <p className="muted">Bodyweight records keep the bodyweight context captured with each set.</p>
        {bodyweightRecords.map(record => <div className="best-row" key={record.exercise}><span>{record.exercise}</span><strong>{record.bodyweightRepRecord!.reps} reps at {toDisplay(record.bodyweightRepRecord!.bodyweightKg, unit)} {unit} bodyweight</strong></div>)}
      </>}
    </section>
  </>;
}

export function SessionDetail({ session, preferences, exercises = [], onClose, onDeleted }: {
  session: Session; preferences: Preferences; exercises?: Exercise[]; onClose: () => void; onDeleted?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unit = preferences.unit;
  const muscles = useMemo(() => getWorkoutMuscles(session.exercises, exercises), [session.exercises, exercises]);

  return <Modal title={session.name} onClose={onClose}>
    <div className="modal-body">
      <div className="saved-badge"><Trophy size={19} />Workout complete</div>
      <p>{new Date(session.startedAt).toLocaleString()} · {duration(session)} min</p>
      {muscles.length > 0 && <div className="day-muscles-row" aria-label="Targeted muscles">
        {muscles.map(m => <span key={m} className="muscle-chip">{m}</span>)}
      </div>}
      <div className="detail-stats">
        <strong>{completedSets(session).length}<small>working sets</small></strong>
        <strong>{showVolume(session.volumeKg, unit)}<small>total volume</small></strong>
      </div>
      {session.exercises.map(exercise => <section className="detail-exercise" key={exercise.id}>
        <h3>{exercise.name}</h3>
        {exercise.sets.filter(s => s.done).map((set, i, completed) => {
          const warmupNumber = completed.slice(0, i + 1).filter(item => item.warmup).length;
          const workingNumber = completed.slice(0, i + 1).filter(item => !item.warmup).length;
          return <div key={set.id}>
          <span>{set.warmup ? `Warm-up ${warmupNumber}` : `Set ${workingNumber}`}</span>
          <strong>{set.weightKg === null ? `${set.reps} reps` : `${toDisplay(set.weightKg, unit)} ${unit} × ${set.reps}`}</strong>
          <span>{showRpe(set.rpe)}</span>
        </div>;
        })}
        {exercise.note && <p>{exercise.note}</p>}
      </section>)}
      {session.note && <p className="note-block">{session.note}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
    <div className="modal-actions">
      {onDeleted && <Button variant="destructive" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api.deleteWorkout(session.id); await onDeleted(); onClose(); }
        catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not delete this workout.'); setBusy(false); }
      }}>Delete from history</Button>}
      <Button variant="primary" onClick={onClose}>Done</Button>
    </div>
  </Modal>;
}
