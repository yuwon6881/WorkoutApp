import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ExerciseClearPreview } from '../types';
import { ApiError, api } from '../lib/api';
import { forgetSessionDetail } from '../lib/sessionDetailLoad';
import { showSetCount } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

/**
 * Clearing an exercise's history is permanent, so it sits at the end of the History tab rather than
 * beside Done, and every press answers in a dialog: the confirmation with what will be removed, or
 * why it cannot run yet (an open workout), instead of a notice somewhere off screen.
 */
export function ExerciseHistoryClearing({ exerciseId, clearableSets, onCleared }: {
  exerciseId: string;
  clearableSets: number;
  onCleared: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<ExerciseClearPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  async function prepare() {
    setChecking(true); setError('');
    try { setPreview(await api.exerciseClearPreview(exerciseId)); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not prepare history clearing.'); }
    finally { setChecking(false); }
  }

  async function clear() {
    setClearing(true); setError('');
    try {
      await api.clearExerciseHistory(exerciseId);
      forgetSessionDetail();
      setPreview(null);
      await onCleared();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not clear this exercise history.');
    } finally { setClearing(false); }
  }

  const close = () => { if (!clearing) { setPreview(null); setError(''); } };

  return <section className="exercise-history-clearing" aria-labelledby="exercise-history-clearing-title">
    <div>
      <h4 id="exercise-history-clearing-title">Clear history</h4>
      <p>Removes this exercise's {showSetCount(clearableSets)} from your records and resets its progress. The workouts stay saved.</p>
    </div>
    <Button variant="destructive" onClick={() => void prepare()} disabled={checking}>
      <RotateCcw size={15} aria-hidden="true" />{checking ? 'Checking…' : 'Clear history'}
    </Button>
    {error && !preview && <p className="error-text" role="alert">{error}</p>}

    {preview?.hasActiveWorkout && <Modal title="Workout in progress" onClose={close}>
      <div className="modal-body">
        <p>Finish or discard the active workout before clearing this exercise's history. Its sets may still change.</p>
        <div className="modal-actions"><Button variant="primary" onClick={close}>OK</Button></div>
      </div>
    </Modal>}
    {preview && !preview.hasActiveWorkout && <Modal title="Clear exercise history?" onClose={close}>
      <div className="modal-body">
        <p>This permanently removes <strong>{showSetCount(preview.affectedSets)}</strong> from <strong>{preview.affectedWorkouts} {preview.affectedWorkouts === 1 ? 'workout' : 'workouts'}</strong> and resets the exercise's progress records. The workouts themselves stay saved. This cannot be undone.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions">
          <Button variant="tertiary" onClick={close} disabled={clearing}>Cancel</Button>
          <Button variant="destructive" onClick={() => void clear()} disabled={clearing}>{clearing ? 'Clearing…' : 'Clear history'}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}
