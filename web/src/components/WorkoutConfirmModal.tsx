import type { Session } from '../types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

export function WorkoutConfirmModal({
  confirm,
  done,
  busy,
  draft,
  retainSwaps,
  onRetainSwapsChange,
  onClose,
  onFinish,
  onDiscard
}: {
  confirm: 'finish' | 'discard';
  done: number;
  busy: boolean;
  draft: Session;
  retainSwaps: boolean;
  onRetainSwapsChange: (retain: boolean) => void;
  onClose: () => void;
  onFinish: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal
      title={confirm === 'finish' ? 'Finish your workout?' : 'Discard this workout?'}
      onClose={onClose}
    >
      <div className="modal-body">
        <p>
          {confirm === 'finish'
            ? `${done} completed working ${done === 1 ? 'set' : 'sets'} will be saved. Unlogged sets will be left out.`
            : 'This removes the session in progress. Your completed history stays as it is.'}
        </p>
        {confirm === 'finish' &&
          draft.exercises.some(e => e.sourcePhaseId && e.isReplacement) && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={retainSwaps}
                onChange={e => onRetainSwapsChange(e.target.checked)}
              />
              Keep exercise swaps for the remaining workouts in this phase.
            </label>
          )}
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Keep training</Button>
        <Button
          variant={confirm === 'finish' ? 'primary' : 'destructive'}
          disabled={busy}
          onClick={confirm === 'finish' ? onFinish : onDiscard}
        >
          {confirm === 'finish' ? 'Save workout' : 'Discard workout'}
        </Button>
      </div>
    </Modal>
  );
}
