import { useState } from 'react';
import type { EditScope } from '../lib/exerciseEditScope';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import './ExerciseScopeOptions.css';

const plural = (count: number, noun: string) => `${count} other ${noun}${count === 1 ? '' : 's'}`;

/// Asks which occurrences of an exercise a saved edit should reach. Only offered when the exercise
/// appears elsewhere, and only with the choices that would change something.
export function ExerciseScopeModal({ exerciseName, changes, counts, busy, error, onConfirm, onCancel }: {
  exerciseName: string;
  changes: string[];
  counts: { block: number; program: number };
  busy: boolean;
  error: string | null;
  onConfirm: (scope: EditScope) => void;
  onCancel: () => void;
}) {
  const options: { value: EditScope; label: string; detail: string }[] = [
    { value: 'occurrence', label: 'This occurrence only', detail: 'Other days and weeks keep what they have' },
    ...(counts.block > 0 ? [{ value: 'block' as const, label: 'Same block', detail: plural(counts.block, 'occurrence') }] : []),
    ...(counts.program > counts.block ? [{ value: 'program' as const, label: 'Whole program', detail: plural(counts.program, 'occurrence') }] : [])
  ];
  // The block is the unit a program prints a movement in, so it is the default when it has company.
  const [scope, setScope] = useState<EditScope>(counts.block > 0 ? 'block' : 'occurrence');

  return <Modal title="Apply these changes to" onClose={onCancel}>
    <div className="modal-body exercise-scope-body">
      <p>
        {exerciseName} appears more than once. Changing its {changes.join(', ')} can reach the others;
        only what you changed is carried over, so their own sets, rest and notes stay as they are.
      </p>
      <fieldset className="exercise-scope-options" disabled={busy}>
        <legend className="sr-only">Where to apply the changes</legend>
        {options.map(option => <label className="checkbox-row exercise-scope-option" key={option.value}>
          <input type="radio" name="exercise-edit-scope" value={option.value} checked={scope === option.value}
            onChange={() => setScope(option.value)} />
          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
        </label>)}
      </fieldset>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
    <div className="modal-actions">
      <Button variant="tertiary" disabled={busy} onClick={onCancel}>Back</Button>
      <Button variant="primary" disabled={busy} onClick={() => onConfirm(scope)}>Save changes</Button>
    </div>
  </Modal>;
}
