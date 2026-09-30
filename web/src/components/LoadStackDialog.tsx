import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Unit } from '../types';
import type { LoadStack } from '../lib/exerciseLoads';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { LoadRuleEditor } from './LoadRuleEditor';

type StackInput = { name: string; loadStepKg: number | null; availableLoadsKg: number[] | null };

/// Creates or edits a named weight stack. Deleting asks first and says how many exercises and
/// equipment types go back to their defaults.
export function LoadStackDialog({ unit, stack, busy, onSave, onDelete, onClose }: {
  unit: Unit;
  stack: LoadStack | null;
  busy: boolean;
  onSave: (input: StackInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(stack?.name ?? '');
  const [nameError, setNameError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameField = useRef<HTMLInputElement | null>(null);
  const users = stack ? stack.exerciseCount + stack.equipmentGroups.length : 0;

  function validateName() {
    const trimmed = name.trim();
    const problem = !trimmed ? 'Name the weight stack.' : trimmed.length > 60 ? 'Use 60 characters or fewer.' : '';
    setNameError(problem);
    if (problem) nameField.current?.focus();
    return !problem;
  }

  return <Modal title={stack ? `Edit ${stack.name}` : 'New weight stack'} onClose={() => !busy && onClose()}>
    <div className="modal-body">
      {confirmDelete ? <div className="load-stack-delete" role="alertdialog" aria-labelledby="load-stack-delete-title">
        <p id="load-stack-delete-title">Delete “{stack?.name}”?{users > 0
          ? ` ${users} ${users === 1 ? 'exercise or equipment type uses' : 'exercises and equipment types use'} it and will follow their defaults again.`
          : ''}</p>
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep stack</Button>
          <Button variant="destructive" disabled={busy} onClick={onDelete}>{busy ? 'Deleting…' : 'Delete stack'}</Button>
        </div>
      </div> : <>
        <LoadRuleEditor unit={unit} name="load-stack" busy={busy} allowInherit={false} allowZeroStep={false} preferList
          rule={{ loadStepKg: stack?.loadStepKg ?? null, availableLoadsKg: stack?.availableLoadsKg ?? null, stackId: null }}
          submitLabel="Save stack" validateExtra={validateName}
          onSubmit={rule => onSave({ name: name.trim(), loadStepKg: rule.loadStepKg, availableLoadsKg: rule.availableLoadsKg })}
          onCancel={onClose}>
          <Field ref={nameField} name="load-stack-name" label="Name" maxLength={60} value={name} error={nameError}
            disabled={busy} placeholder="Gym B cable" onChange={event => { setName(event.target.value); setNameError(''); }} />
        </LoadRuleEditor>
        {onDelete && <div className="load-stack-delete-row">
          <Button variant="destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} aria-hidden="true" /> Delete stack
          </Button>
        </div>}
      </>}
    </div>
  </Modal>;
}
