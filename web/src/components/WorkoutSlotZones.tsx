import type { ReactNode } from 'react';
import { Dumbbell, FileText, MousePointerClick, Plus } from 'lucide-react';
import { slotItemName } from '../lib/activeSlot';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import type { SlotDragState } from './useWorkoutSlotDrag';
import type { SlotConfirmation } from './useWorkoutSlotActions';

/// The active slot. Empty, it is a dashed target inviting a library card to be dropped in; with
/// nothing saved yet it offers the two ways to create a first workout instead.
export function ActiveSlotDropZone({ over, occupied, hasLibrary, onNewWorkout, onImport, children }: {
  over: boolean;
  occupied: boolean;
  hasLibrary: boolean;
  onNewWorkout: () => void;
  onImport: () => void;
  children: ReactNode;
}) {
  if (occupied) {
    return <div className={`active-slot-zone occupied ${over ? 'slot-zone-over' : ''}`} data-slot-zone="active">
      {children}
      {over && <p className="active-slot-replace" role="status">Drop to make this your active workout</p>}
    </div>;
  }

  if (!hasLibrary) {
    return <section className="panel active-slot-zone active-slot-empty first-run pp-active-slot-card pp-first-run-card" data-slot-zone="active" aria-label="Active plan">
      <div className="pp-slot-content">
        <div className="pp-slot-icon-tile" aria-hidden="true">
          <Dumbbell size={22} />
        </div>
        <div className="active-slot-empty-copy pp-slot-copy">
          <h3>Ready for your first workout</h3>
          <p className="pp-slot-help-text">Build one by hand, or import a program from a PDF. It will wait in your library until you drag it here.</p>
        </div>
      </div>
      <div className="slot-card-actions pp-first-run-actions">
        <Button variant="secondary" onClick={onImport} className="pp-first-run-btn"><FileText size={15} />Import a PDF</Button>
        <Button variant="primary" onClick={onNewWorkout} className="pp-first-run-btn"><Plus size={15} />Build a workout</Button>
      </div>
    </section>;
  }

  return <section className={`active-slot-zone active-slot-empty pp-active-slot-card pp-active-slot-drop-target ${over ? 'slot-zone-over' : ''}`} data-slot-zone="active" aria-label="Active plan">
    <div className="pp-slot-content">
      <span className="active-slot-empty-icon pp-slot-icon-tile" aria-hidden="true"><MousePointerClick size={22} /></span>
      <div className="active-slot-empty-copy pp-slot-copy">
        <h3>{over ? 'Drop to activate' : 'Drag a workout here to activate it'}</h3>
        <p>Or choose <strong>Make active</strong> from a library card’s menu.</p>
      </div>
    </div>
  </section>;
}

/// The card following the pointer while it is dragged. It never takes pointer events, so the
/// zone beneath the pointer can always be found.
export function SlotDragGhost({ drag }: { drag: SlotDragState }) {
  return <div className={`slot-drag-ghost ${drag.returning ? 'returning' : ''}`} aria-hidden="true"
    style={{ width: Math.min(drag.width, 420), transform: `translate(${drag.x - Math.min(drag.offsetX, 400)}px, ${drag.y - drag.offsetY}px)` }}>
    <strong>{slotItemName(drag.item)}</strong>
    <span>{drag.item.kind === 'program' ? 'Program' : 'Workout'}</span>
  </div>;
}

export function SlotConfirmDialog({ confirmation, onCancel, onConfirm }: {
  confirmation: SlotConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <Modal title={confirmation.title} onClose={onCancel}>
    <div className="modal-body"><p>{confirmation.body}</p></div>
    <div className="modal-actions">
      <Button variant="tertiary" onClick={onCancel}>Cancel</Button>
      <Button variant="destructive" onClick={onConfirm}>{confirmation.action}</Button>
    </div>
  </Modal>;
}
