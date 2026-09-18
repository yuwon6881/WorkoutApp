import { Copy, Layers, Plus } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

export type AddWeekMode = 'duplicate-current' | 'copy-block' | 'empty';

export function AddWeekModal({
  open,
  onClose,
  onAddWeek,
  currentWeekNumber,
  blockName,
  phaseName
}: {
  open: boolean;
  onClose: () => void;
  onAddWeek: (mode: AddWeekMode) => void;
  currentWeekNumber: number;
  blockName: string;
  phaseName?: string | null;
}) {
  if (!open) return null;

  return (
    <Modal title="Add a week" onClose={onClose}>
      <div className="modal-body week-create-options">
        <p>Choose how the new week should start. You can customize its days and prescriptions after it is added.</p>

        <div className="tiny-label" style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: '4px 0 2px' }}>
          <span>Targeting:</span>
          <span className="pill pill-accent">{blockName || 'Current Block'}</span>
          {phaseName && <span className="pill">{phaseName}</span>}
        </div>

        <Button
          variant="secondary"
          className="week-create-option"
          onClick={() => onAddWeek('duplicate-current')}
        >
          <Copy size={18} />
          <span>
            <strong>Duplicate Week {currentWeekNumber}</strong>
            <small>Copy all training days, mapped exercises, and set prescriptions from Week {currentWeekNumber}.</small>
          </span>
        </Button>

        <Button
          variant="secondary"
          className="week-create-option"
          onClick={() => onAddWeek('copy-block')}
        >
          <Layers size={18} />
          <span>
            <strong>Add structured week to {blockName || 'Block'}</strong>
            <small>Continue this block with the structure from its most recent week.</small>
          </span>
        </Button>

        <Button
          variant="secondary"
          className="week-create-option"
          onClick={() => onAddWeek('empty')}
        >
          <Plus size={18} />
          <span>
            <strong>Start empty</strong>
            <small>Add a blank training day in this block that you can name, map, and prescribe from scratch.</small>
          </span>
        </Button>
      </div>
    </Modal>
  );
}
