import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ExerciseClearPreview } from '../types';
import { ApiError, api } from '../lib/api';
import { forgetSessionDetail } from '../lib/sessionDetailLoad';
import { showSetCount } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

/// An open workout that includes the exercise reads its history for the targets and records it froze
/// at start, its "Last time" figures and the progress rebuilt at finish. The server refuses to clear
/// under it, so the section says why up front instead of offering a press that cannot succeed.
function blockedReason(preview: ExerciseClearPreview): string {
  const workout = preview.activeWorkoutName ? `“${preview.activeWorkoutName}”` : 'Your open workout';
  return `${workout} includes this exercise and uses its history for today's targets and records. Finish or discard it to clear this history.`;
}

/**
 * Clearing an exercise's history is permanent, so it sits at the end of the History tab rather than
 * beside Done, and every press answers in a dialog: the confirmation with what will be removed, or
 * why it cannot run yet. The server checks again under its lock, so a workout started elsewhere
 * after the check turns the confirmation into the same explanation rather than a cleared history.
 */
export function ExerciseHistoryClearing({ exerciseId, clearableSets, onCleared }: {
  exerciseId: string;
  clearableSets: number;
  onCleared: () => Promise<void>;
}) {
  // The latest check; `null` until it answers, when the section offers the plain press.
  const [checked, setChecked] = useState<ExerciseClearPreview | null>(null);
  const [dialog, setDialog] = useState<ExerciseClearPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    // Best effort: without an answer the press below checks again before anything is removed.
    api.exerciseClearPreview(exerciseId, controller.signal).then(setChecked).catch(() => undefined);
    return () => controller.abort();
  }, [exerciseId]);

  async function check(): Promise<ExerciseClearPreview | null> {
    setChecking(true); setError('');
    try {
      const preview = await api.exerciseClearPreview(exerciseId);
      setChecked(preview);
      return preview;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not prepare history clearing.');
      return null;
    } finally { setChecking(false); }
  }

  async function prepare() {
    const preview = await check();
    if (preview) setDialog(preview);
  }

  async function clear() {
    setClearing(true); setError('');
    try {
      await api.clearExerciseHistory(exerciseId);
      forgetSessionDetail();
      setDialog(null);
      await onCleared();
    } catch (failure) {
      // A workout with this exercise opened after the check: show why, from a fresh check.
      if (failure instanceof ApiError && failure.conflict) {
        const preview = await check();
        if (preview) { setDialog(preview); return; }
      }
      setError(failure instanceof ApiError ? failure.message : 'Could not clear this exercise history.');
    } finally { setClearing(false); }
  }

  const close = () => { if (!clearing) { setDialog(null); setError(''); } };
  const blocked = checked?.hasActiveWorkout ? checked : null;

  return <section className="exercise-history-clearing" aria-labelledby="exercise-history-clearing-title">
    <div>
      <h4 id="exercise-history-clearing-title">Clear history</h4>
      <p>{blocked
        ? blockedReason(blocked)
        : `Removes this exercise's ${showSetCount(clearableSets)} from your records and resets its progress. The workouts stay saved.`}</p>
    </div>
    {blocked
      ? <Button variant="secondary" onClick={() => void check()} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</Button>
      : <Button variant="destructive" onClick={() => void prepare()} disabled={checking}>
        <RotateCcw size={15} aria-hidden="true" />{checking ? 'Checking…' : 'Clear history'}
      </Button>}
    {error && !dialog && <p className="error-text" role="alert">{error}</p>}

    {dialog?.hasActiveWorkout && <Modal title="Workout in progress" onClose={close}>
      <div className="modal-body">
        <p>{blockedReason(dialog)}</p>
        <div className="modal-actions"><Button variant="primary" onClick={close}>OK</Button></div>
      </div>
    </Modal>}
    {dialog && !dialog.hasActiveWorkout && <Modal title="Clear exercise history?" onClose={close}>
      <div className="modal-body">
        <p>This permanently removes <strong>{showSetCount(dialog.affectedSets)}</strong> from <strong>{dialog.affectedWorkouts} {dialog.affectedWorkouts === 1 ? 'workout' : 'workouts'}</strong> and resets the exercise's progress records. The workouts themselves stay saved. This cannot be undone.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions">
          <Button variant="tertiary" onClick={close} disabled={clearing}>Cancel</Button>
          <Button variant="destructive" onClick={() => void clear()} disabled={clearing}>{clearing ? 'Clearing…' : 'Clear history'}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}
