import { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import type { LoggedSet, Preferences, SessionExercise, SetPrescription } from '../types';
import { showTarget, showWeight, toDisplay, toKg } from '../lib/training';
import { effortPatch, effortValue, loadIsEditable, setNumberLabel } from '../lib/workoutDraft';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { RpeControl } from './ui/RpeControl';
import { nextAvailableLoad } from '../lib/exerciseLoads';

export const resistanceModeOptions: Array<{ value: NonNullable<LoggedSet['resistanceMode']>; label: string }> = [
  { value: 'bodyweight', label: 'BW' },
  { value: 'added', label: '+Load' },
  { value: 'assistance', label: 'Assist' }
];

export function WorkoutSetRow({
  set,
  si,
  ei,
  exercise,
  plan,
  unit,
  loadStepKg = 2.5,
  availableLoadsKg,
  editSet,
  toggle,
  onRemoveSet
}: {
  set: LoggedSet;
  si: number;
  ei: number;
  exercise: SessionExercise;
  plan: SetPrescription | undefined;
  unit: Preferences['unit'];
  loadStepKg?: number;
  availableLoadsKg?: number[] | null;
  editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void;
  toggle: (ei: number, si: number) => void;
  onRemoveSet: (si: number) => void;
}) {
  // Set only by the tap that logs a set, so rows already done do not replay it when shown again.
  const [justLogged, setJustLogged] = useState(false);
  const shown = toDisplay(set.weightKg, unit);
  const { label, warmup } = setNumberLabel(exercise, si);
  const loadModel = exercise.loadModel ?? 'external';
  const loadEditable = loadIsEditable(exercise, set);

  return (
    <div
      className={`workout-set-row ${set.done ? 'done' : ''} ${warmup ? 'warmup-row' : ''} ${
        set.suggestion ? 'has-suggestion' : ''
      } ${justLogged ? 'just-logged' : ''}`}
      onAnimationEnd={event => { if (event.target === event.currentTarget) setJustLogged(false); }}
    >
      <span className="set-badge-circle" title={warmup ? 'Warm-up set' : 'Working set'}>
        {label}
      </span>

      <div className="set-target-cell">
        <span className="target-text">{plan ? showTarget(plan) : '—'}</span>
        {set.suggestion && (
          <small className="suggestion-text" title={set.suggestion.reason}>
            {set.suggestion.suggestedLoadKg != null
              ? `${showWeight(set.suggestion.suggestedLoadKg, unit)}`
              : 'Suggested'}
          </small>
        )}
      </div>

      <div className="set-input-cell load-cell">
        <input
          name={`weight-${exercise.id}-${si}`}
          aria-label={`${exercise.name} set ${si + 1} weight`}
          inputMode="decimal"
          type="number"
          min="0"
          step={availableLoadsKg?.length || loadStepKg <= 0 ? 'any' : toDisplay(loadStepKg, unit) ?? 'any'}
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            const next = availableLoadsKg?.length
              ? nextAvailableLoad(set.weightKg, availableLoadsKg, direction)
              : Math.max(0, (set.weightKg ?? 0) + direction * loadStepKg);
            editSet(ei, si, { weightKg: next });
          }}
          placeholder="—"
          value={shown === null ? '' : shown}
          disabled={!loadEditable}
          // Correcting a logged set keeps it logged; only the log button unlogs a set.
          onChange={e =>
            editSet(ei, si, { weightKg: e.target.value === '' ? null : toKg(Number(e.target.value), unit) })
          }
        />
        {loadModel === 'full_bodyweight' && (
          <Select
            className="mode-mini-select"
            ariaLabel="Resistance mode"
            value={set.resistanceMode ?? 'bodyweight'}
            options={resistanceModeOptions}
            onChange={val => editSet(ei, si, { resistanceMode: val })}
          />
        )}
      </div>

      <div className="set-input-cell reps-cell">
        <input
          name={`reps-${exercise.id}-${si}`}
          aria-label={`${exercise.name} set ${si + 1} reps`}
          inputMode="numeric"
          type="number"
          placeholder="—"
          value={set.reps ?? ''}
          onChange={e => editSet(ei, si, { reps: e.target.value === '' ? null : Number(e.target.value) })}
        />
      </div>

      <div className="set-input-cell rpe-cell">
        <RpeControl
          compact
          name={`rir-${exercise.id}-${si}`}
          ariaLabel={`${exercise.name} set ${si + 1} RIR`}
          value={effortValue(set)}
          onChange={value => editSet(ei, si, effortPatch(value))}
        />
      </div>

      <div className="set-action-cell log-cell">
        <Button
          presentation="plain"
          className={`set-log-checkbox ${set.done ? 'checked' : ''}`}
          aria-label={`${set.done ? 'Unlog' : 'Log'} ${exercise.name} set ${si + 1}`}
          aria-pressed={set.done}
          onClick={() => {
            setJustLogged(!set.done);
            toggle(ei, si);
          }}
        >
          <Check size={18} strokeWidth={set.done ? 3 : 2} />
        </Button>
      </div>

      <div className="set-action-cell del-cell">
        <Button
          variant="tertiary"
          className="set-del-btn"
          aria-label={`Remove ${exercise.name} set ${si + 1}`}
          disabled={exercise.sets.length <= 1}
          onClick={() => onRemoveSet(si)}
        >
          <Minus size={14} />
        </Button>
      </div>
    </div>
  );
}
