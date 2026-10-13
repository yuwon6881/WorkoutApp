import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import './ImportRestoreDraftModal.css';

/// Confirms throwing away every manual change and returning the draft to the first extraction.
export function ImportRestoreDraftModal({ onClose, onRestore }: {
  onClose: () => void;
  onRestore: () => Promise<void>;
}) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setRestoring(true);
    setError(null);
    try {
      await onRestore();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not restore default draft.');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Modal title="Restore default draft" onClose={() => !restoring && onClose()}>
      <div className="modal-body irev-modal-body" aria-busy={restoring}>
        <p className="irev-modal-consequence">
          Reset all exercises, mappings, notes, sets, and rep ranges across this entire program to the initial extracted version from the PDF?
        </p>
        <p className="muted irev-modal-secondary">
          All manual adjustments made since extraction will be replaced with the default baseline.
        </p>
        {error && <p className="error-text irev-modal-error" role="alert">{error}</p>}
      </div>
      <div className="modal-actions irev-modal-actions">
        <Button variant="secondary" className="irev-modal-btn" disabled={restoring} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" className="irev-modal-btn" disabled={restoring} aria-busy={restoring} onClick={() => void restore()}>
          {restoring ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
          {restoring ? 'Restoring…' : 'Restore default draft'}
        </Button>
      </div>
    </Modal>
  );
}
