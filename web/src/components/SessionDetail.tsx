import { useMemo } from 'react';
import { Clock3, Dumbbell, Layers, Trophy } from 'lucide-react';
import type { Exercise, Preferences, Session } from '../types';
import { getSessionMuscleCredits } from '../lib/sessionMuscles';
import { duration, showVolume } from '../lib/training';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { Modal } from './ui/Modal';
import { SessionExerciseList } from './SessionExerciseList';
import { SessionMuscleStrip } from './SessionMuscleStrip';
import { useSessionDetail } from './useSessionDetail';
import './SessionDetail.css';

/// A finished workout. Straight after Finish it opens as the session's result; from history it is
/// the same summary without the celebration. A history row opens it at once from its summary, and
/// the exercises fill in when the full session arrives.
export function SessionDetail({ session: initial, preferences, exercises = [], catalogLoading = false, justFinished = false, onClose }: {
  session: Session;
  preferences: Preferences;
  exercises?: Exercise[];
  /** The library decides which muscles an exercise trains; until it arrives the muscles wait. */
  catalogLoading?: boolean;
  justFinished?: boolean;
  onClose: () => void;
}) {
  const { session, loading, error, retry } = useSessionDetail(initial);
  const unit = preferences.unit;
  const muscles = useMemo(
    () => loading || catalogLoading ? null : getSessionMuscleCredits(session.exercises, exercises),
    [loading, catalogLoading, session.exercises, exercises]
  );
  const skipped = session.exercises.filter(exercise => !exercise.sets.some(set => set.done));
  const prCount = session.prCount ?? 0;
  const when = new Date(session.startedAt).toLocaleString('en', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  return <Modal title={session.name} onClose={onClose} wide>
    <div className="modal-body session-summary">
      <header className={`session-summary-hero${justFinished ? ' celebrate' : ''}`}>
        <div className="session-summary-top">
          <span className="session-summary-icon" aria-hidden="true"><Trophy size={22} /></span>
          <div className="session-summary-heading">
            <p className="session-summary-kicker">{session.active ? 'Workout in progress' : justFinished ? 'Workout complete' : 'Completed workout'}</p>
            <p className="session-summary-when">{when}</p>
          </div>
        </div>
        <dl className="session-summary-stats">
          <div><dt><Clock3 size={14} aria-hidden="true" />Duration</dt><dd>{duration(session)}<small>min</small></dd></div>
          <div><dt><Layers size={14} aria-hidden="true" />Working sets</dt><dd>{session.completedSets}</dd></div>
          <div><dt><Dumbbell size={14} aria-hidden="true" />Volume</dt><dd>{showVolume(session.volumeKg, unit)}</dd></div>
          <div className={prCount > 0 ? 'has-records' : undefined}>
            <dt><Trophy size={14} aria-hidden="true" />Personal bests</dt><dd>{prCount}</dd>
          </div>
        </dl>
      </header>

      {error ? (
        <CardFeedback title="Exercises unavailable" message={error} action={{ label: 'Retry', onClick: retry }} />
      ) : <>
        <SessionMuscleStrip summary={muscles} loading={loading || catalogLoading} />
        <SessionExerciseList exercises={session.exercises} unit={unit} loading={loading} />
      </>}

      {skipped.length > 0 && <p className="session-summary-skipped">
        Not logged: {skipped.map(exercise => exercise.name).join(', ')}
      </p>}
      {session.note && <p className="note-block">{session.note}</p>}
    </div>
    <div className="modal-actions">
      <Button variant="primary" onClick={onClose}>Done</Button>
    </div>
  </Modal>;
}
