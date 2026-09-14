import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, CalendarDays, Dumbbell, Trophy } from 'lucide-react';
import type { HistoryPage, Preferences, ProgressSummary, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { completedSets, duration, showRpe, showVolume, showWeight, toDisplay } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

export function HistoryView({ initial, preferences, onSession, onStart }: {
  initial: HistoryPage; preferences: Preferences; onSession: (s: Session) => void; onStart: () => void;
}) {
  const [page, setPage] = useState<HistoryPage>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const unit = preferences.unit;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.history(0, 20)
      .then(next => { if (!cancelled) { setPage(next); setError(''); } })
      .catch(failure => { if (!cancelled) setError(failure instanceof ApiError ? failure.message : 'Could not load your history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api.progress().then(next => { if (!cancelled) setProgress(next); }).catch(() => { /* history remains usable if the optional records read is unavailable */ });
    api.refreshNutritionContext().catch(() => { /* progression context is optional */ });
    return () => { cancelled = true; };
  }, []);

  async function more() {
    setLoading(true);
    try {
      const next = await api.history(page.page + 1, page.size);
      setPage({ ...next, sessions: [...page.sessions, ...next.sessions] });
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load more history.'); }
    finally { setLoading(false); }
  }

  const sessions = page.sessions;
  const known = sessions.filter(s => s.volumeKg !== null);
  const totalVolume = known.length ? known.reduce((total, s) => total + (s.volumeKg ?? 0), 0) : null;
  const bests = Object.entries(sessions.flatMap(s => s.exercises).reduce<Record<string, number>>((acc, exercise) => {
    for (const set of exercise.sets) if (set.done && !set.warmup && set.weightKg !== null) acc[exercise.name] = Math.max(acc[exercise.name] ?? -1, set.weightKg);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const bodyweightRecords = progress?.exercises.filter(exercise => exercise.bodyweightRepRecord !== null) ?? [];

  return <>
    <div className="page-heading">
      <div><div className="eyebrow">PROOF OF THE WORK YOU PUT IN</div><h1>Your progress<span className="accent">.</span></h1><p>Small steps. Stronger numbers. A story that’s yours.</p></div>
      <span className="muted">{page.total} completed {page.total === 1 ? 'workout' : 'workouts'}</span>
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="stats-grid progress-stats">
      <div className="stat-card"><div className="stat-label"><CalendarDays size={17} />Workouts</div><strong>{page.total}</strong><span className="muted">Completed sessions</span></div>
      <div className="stat-card"><div className="stat-label"><BarChart3 size={17} />Total volume</div><strong>{showVolume(totalVolume, unit)}</strong><span className="muted">Weight × reps, where the load was recorded</span></div>
      <div className="stat-card"><div className="stat-label"><Dumbbell size={17} />Training time</div><strong>{sessions.reduce((total, s) => total + duration(s), 0)}<small> min</small></strong><span className="muted">Time you invested in yourself</span></div>
    </div>

    <section className="panel">
      <div className="section-heading"><h2>Personal bests</h2><Trophy size={18} className="accent" /></div>
      <p className="muted">Heaviest completed working set</p>
      {bests.length ? bests.slice(0, 6).map(([name, kg]) => <div className="best-row" key={name}><span>{name}</span><strong>{showWeight(kg, unit)}</strong></div>)
        : <div className="empty-message"><Trophy size={30} /><p>Your first personal best is waiting.<br />Log a workout to get started.</p></div>}
    </section>

    {bodyweightRecords.length > 0 && <section className="panel">
      <div className="section-heading"><h2>Bodyweight records</h2><Trophy size={18} className="accent" /></div>
      <p className="muted">Reps stay separate from effective load. These records keep the frozen bodyweight context beside the achievement.</p>
      {bodyweightRecords.map(record => <div className="best-row" key={record.exercise}><span>{record.exercise}</span><strong>{record.bodyweightRepRecord!.reps} reps at {toDisplay(record.bodyweightRepRecord!.bodyweightKg, unit)} {unit} bodyweight</strong></div>)}
    </section>}

    <section className="panel">
      <div className="section-heading"><h2>Workout history</h2><span className="muted">{sessions.length} of {page.total}</span></div>
      {sessions.map(session => <Button className="history-row" variant="tertiary" key={session.id} onClick={() => onSession(session)}>
        <span className="exercise-icon"><Dumbbell size={20} /></span>
        <span className="row-title"><strong>{session.name}</strong>
          <small>{new Date(session.startedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })} · {duration(session)} min · {session.completedSets} sets</small></span>
        <span>{showVolume(session.volumeKg, unit)}</span>
        <ArrowRight size={16} />
      </Button>)}
      {!sessions.length && !loading && <div className="empty-message"><Dumbbell size={32} /><h3>No completed workouts yet</h3>
        <p>Finish a workout and it will appear here with its sets, volume, and effort.</p>
        <Button onClick={onStart}>Find a workout<ArrowRight size={16} /></Button></div>}
      {sessions.length < page.total && <Button className="full-width" disabled={loading} onClick={more}>{loading ? 'Loading…' : 'Load more'}</Button>}
    </section>
  </>;
}

export function SessionDetail({ session, preferences, onClose, onDeleted }: {
  session: Session; preferences: Preferences; onClose: () => void; onDeleted?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unit = preferences.unit;

  return <Modal title={session.name} onClose={onClose}>
    <div className="modal-body">
      <div className="saved-badge"><Trophy size={19} />Workout complete</div>
      <p>{new Date(session.startedAt).toLocaleString()} · {duration(session)} min</p>
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
