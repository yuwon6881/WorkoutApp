import { useMemo, useState } from 'react';
import { Clock3, Dumbbell, Layers, Trophy } from 'lucide-react';
import type { Exercise, Preferences, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { getWorkoutMuscles } from '../lib/muscles';
import { completedSets, duration, showActualRir, showVolume, toDisplay } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import './SessionDetail.css';

/// A finished workout. Straight after Finish it opens as the session's result; from history it is
/// the same summary without the celebration.
export function SessionDetail({ session, preferences, exercises = [], justFinished = false, onClose, onDeleted }: {
  session: Session;
  preferences: Preferences;
  exercises?: Exercise[];
  justFinished?: boolean;
  onClose: () => void;
  onDeleted?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unit = preferences.unit;
  const muscles = useMemo(() => getWorkoutMuscles(session.exercises, exercises), [session.exercises, exercises]);
  const logged = session.exercises.filter(exercise => exercise.sets.some(set => set.done));
  const skipped = session.exercises.filter(exercise => !exercise.sets.some(set => set.done));
  const prCount = session.prCount ?? 0;
  const when = new Date(session.startedAt).toLocaleString('en', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  return <Modal title={session.name} onClose={onClose}>
    <div className="modal-body session-summary">
      <header className={`session-summary-hero ${justFinished ? 'celebrate' : ''}`.trim()}>
        <span className="session-summary-icon" aria-hidden="true"><Trophy size={22} /></span>
        <div className="session-summary-heading">
          <p className="session-summary-kicker">{justFinished ? 'Workout complete' : 'Completed workout'}</p>
          <p className="session-summary-when">{when}</p>
        </div>
      </header>

      {prCount > 0 && <p className="session-summary-pr">
        <Trophy size={16} aria-hidden="true" />
        {prCount} personal best{prCount === 1 ? '' : 's'} achieved
      </p>}

      <dl className="session-summary-stats">
        <div><dt><Clock3 size={14} aria-hidden="true" />Duration</dt><dd>{duration(session)}<small>min</small></dd></div>
        <div><dt><Layers size={14} aria-hidden="true" />Working sets</dt><dd>{completedSets(session).length}</dd></div>
        <div><dt><Dumbbell size={14} aria-hidden="true" />Volume</dt><dd>{showVolume(session.volumeKg, unit)}</dd></div>
        <div><dt><Trophy size={14} aria-hidden="true" />Personal bests</dt><dd>{prCount}</dd></div>
      </dl>

      {muscles.length > 0 && <div className="day-muscles-row" aria-label="Targeted muscles">
        {muscles.map(m => <span key={m} className="muscle-chip">{m}</span>)}
      </div>}

      <div className="session-summary-exercises">
        {logged.map(exercise => <section className="session-summary-exercise" key={exercise.id}>
          <div className="detail-exercise-header">
            <h3>{exercise.name}</h3>
            {exercise.isPr && <span className="pill pill-accent pr-exercise-badge">
              <Trophy size={12} /> PR{exercise.prE1rmKg != null ? ` · ${toDisplay(exercise.prE1rmKg, unit)} ${unit} e1RM` : ''}
            </span>}
          </div>
          <ol className="session-summary-sets">
            {exercise.sets.filter(s => s.done).map((set, i, done) => {
              const number = done.slice(0, i + 1).filter(item => item.warmup === set.warmup).length;
              return <li key={set.id} className={set.isPr ? 'pr-set-row' : ''}>
                <span className="session-set-label">{set.warmup ? `Warm-up ${number}` : `Set ${number}`}</span>
                <strong>{set.weightKg === null ? `${set.reps} reps` : `${toDisplay(set.weightKg, unit)} ${unit} × ${set.reps}`}</strong>
                <span className="session-set-effort">{showActualRir(set.rir, set.rpe)}</span>
                {set.isPr && <span className="pill pill-accent pr-set-tag"><Trophy size={10} /> PR</span>}
              </li>;
            })}
          </ol>
          {exercise.note && <p className="session-summary-note">{exercise.note}</p>}
        </section>)}
      </div>

      {skipped.length > 0 && <p className="session-summary-skipped">
        Not logged: {skipped.map(exercise => exercise.name).join(', ')}
      </p>}
      {session.note && <p className="note-block">{session.note}</p>}
    </div>
    <div className="modal-actions">
      {error && <p className="error-text modal-actions-error" role="alert">{error}</p>}
      {onDeleted && <Button variant="destructive" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api.deleteWorkout(session.id); await onDeleted(); onClose(); }
        catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not delete this workout.'); setBusy(false); }
      }}>Delete from history</Button>}
      <Button variant="primary" onClick={onClose}>Done</Button>
    </div>
  </Modal>;
}
