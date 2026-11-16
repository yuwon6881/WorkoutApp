import { useState } from 'react';
import type { EditScope } from '../lib/exerciseEditScope';
import { reviewDefaultScope, type ExerciseEdit, type PendingEdit } from '../lib/exerciseBatchEdit';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select, type SelectOption } from './ui/Select';
import './ExerciseScopeOptions.css';

const plural = (count: number) => `${count} other occurrence${count === 1 ? '' : 's'}`;
type RowChoice = EditScope | 'shared';

/// One review for everything edited on a day: where the changes should reach, once, with an
/// override only for the exercises that appear elsewhere in the program and may want a different answer.
export function ExerciseBatchScopeModal({ pending, busy, error, onConfirm, onCancel }: {
  pending: PendingEdit[];
  busy: boolean;
  error: string | null;
  onConfirm: (edits: ExerciseEdit[]) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<EditScope>(() => reviewDefaultScope(pending));
  const [overrides, setOverrides] = useState<Record<string, EditScope>>({});
  const reached = (key: 'block' | 'program') => pending.reduce((sum, item) => sum + item.counts[key], 0);
  const blockReach = reached('block');
  const programReach = reached('program');
  const options: { value: EditScope; label: string; detail: string }[] = [
    { value: 'occurrence', label: 'This occurrence only', detail: 'Other days and weeks keep what they have' },
    ...(blockReach > 0 ? [{ value: 'block' as const, label: 'Same block', detail: plural(blockReach) }] : []),
    ...(programReach > blockReach ? [{ value: 'program' as const, label: 'Whole program', detail: plural(programReach) }] : [])
  ];
  const rowOptions = (item: PendingEdit): SelectOption<RowChoice>[] => [
    { value: 'shared', label: 'Same as above' },
    { value: 'occurrence', label: 'This occurrence only' },
    ...(item.counts.block > 0 ? [{ value: 'block' as const, label: 'Same block' }] : []),
    ...(item.counts.program > item.counts.block ? [{ value: 'program' as const, label: 'Whole program' }] : [])
  ];
  const setRowScope = (lineId: string, choice: RowChoice) => setOverrides(current => {
    const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== lineId));
    return choice === 'shared' ? rest : { ...rest, [lineId]: choice };
  });

  return <Modal title={`Save changes to ${pending.length} exercises`} onClose={onCancel}>
    <div className="modal-body exercise-scope-body">
      <p>
        Some of these exercises appear more than once. Only what you changed is carried over,
        so the other occurrences keep their own sets, rest and notes.
      </p>
      <fieldset className="exercise-scope-options" disabled={busy}>
        <legend className="sr-only">Where to apply the changes</legend>
        {options.map(option => <label className="checkbox-row exercise-scope-option" key={option.value}>
          <input type="radio" name="exercise-batch-scope" value={option.value} checked={scope === option.value}
            onChange={() => setScope(option.value)} />
          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
        </label>)}
      </fieldset>
      <ul className="exercise-batch-list" aria-label="Exercises being saved">
        {pending.map(item => <li className="exercise-batch-row" key={item.base.lineId}>
          <span className="exercise-batch-name">
            <strong>{item.base.sourceName}</strong>
            <small>{item.changes.join(', ')}{item.counts.program > 0 ? '' : ' · this day only'}</small>
          </span>
          {item.counts.program > 0 && <Select<RowChoice> ariaLabel={`Where to apply the changes to ${item.base.sourceName}`}
            value={overrides[item.base.lineId] ?? 'shared'} disabled={busy} options={rowOptions(item)}
            onChange={choice => setRowScope(item.base.lineId, choice)} />}
        </li>)}
      </ul>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
    <div className="modal-actions">
      <Button variant="tertiary" disabled={busy} onClick={onCancel}>Back</Button>
      <Button variant="primary" disabled={busy}
        onClick={() => onConfirm(pending.map(item => ({ base: item.base, edited: item.edited, scope: overrides[item.base.lineId] ?? scope })))}>
        Save {pending.length} exercises
      </Button>
    </div>
  </Modal>;
}
