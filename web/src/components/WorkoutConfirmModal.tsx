import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { FinishPlanChoice } from './FinishPlanChoice';
import type { FinishPlanUpdate } from './useFinishPlanUpdate';

export function WorkoutConfirmModal({
  confirm,
  done,
  unlogged,
  busy,
  planUpdate,
  onClose,
  onFinish,
  onDiscard,
  onRestore
}: {
  confirm: 'finish' | 'discard' | 'restore';
  done: number;
  /** Working sets planned but not logged; they are left out of the saved workout. */
  unlogged: number;
  busy: boolean;
  /** The offer to carry this workout's plan changes into its program, when finishing. */
  planUpdate: FinishPlanUpdate;
  onClose: () => void;
  onFinish: () => void;
  onDiscard: () => void;
  onRestore: () => void;
}) {
  if (confirm === 'restore') return (
    <Modal title="Restore program defaults?" onClose={onClose}>
      <div className="modal-body">
        <p>Exercises, sets and set types go back to the program. Sets you have logged are kept.</p>
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Keep changes</Button>
        <Button variant="primary" disabled={busy} onClick={onRestore}>Restore defaults</Button>
      </div>
    </Modal>
  );
  return (
    <Modal
      title={confirm === 'finish' ? 'Finish your workout?' : 'Discard this workout?'}
      onClose={onClose}
    >
      <div className="modal-body">
        <p>
          {confirm === 'finish'
            ? `${done} completed working ${done === 1 ? 'set' : 'sets'} will be saved.${unlogged > 0 ? ` ${unlogged} unlogged ${unlogged === 1 ? 'set' : 'sets'} will be left out.` : ''}`
            : 'This removes the session in progress. Your completed history stays as it is.'}
        </p>
        {confirm === 'finish' && <FinishPlanChoice update={planUpdate} disabled={busy} />}
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
