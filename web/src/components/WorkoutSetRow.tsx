import { Check, Minus } from 'lucide-react';
import type { LoggedSet, Preferences, SessionExercise, SetPrescription } from '../types';
import { showTarget, showWeight, toDisplay, toKg } from '../lib/training';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { RpeControl } from './ui/RpeControl';

const resistanceModeOptions: Array<{ value: NonNullable<LoggedSet['resistanceMode']>; label: string }> = [
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
  warmupNumber,
  workingNumber,
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
  warmupNumber: number;
  workingNumber: number;
  editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void;
  toggle: (ei: number, si: number) => void;
  onRemoveSet: (si: number) => void;
}) {
  const shown = toDisplay(set.weightKg, unit);
  const warmup = set.warmup || plan?.warmup;
  const loadModel = exercise.loadModel ?? 'external';
  const loadEditable =
    loadModel === 'external' ||
    (loadModel === 'full_bodyweight' && (set.resistanceMode ?? 'bodyweight') !== 'bodyweight');

  return (
    <div
      className={`workout-set-row ${set.done ? 'done' : ''} ${warmup ? 'warmup-row' : ''} ${
        set.suggestion ? 'has-suggestion' : ''
      }`}
    >
      <span className="set-badge-circle" title={warmup ? 'Warm-up set' : 'Working set'}>
        {warmup ? `W${warmupNumber}` : workingNumber}
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
          placeholder="—"
          value={shown === null ? '' : shown}
          disabled={!loadEditable}
          onChange={e =>
            editSet(ei, si, {
              weightKg: e.target.value === '' ? null : toKg(Number(e.target.value), unit),
              done: false
            })
          }
        />
        {loadModel === 'full_bodyweight' && (
          <Select
            className="mode-mini-select"
            ariaLabel="Resistance mode"
            value={set.resistanceMode ?? 'bodyweight'}
            options={resistanceModeOptions}
            onChange={val =>
              editSet(ei, si, {
                resistanceMode: val,
                done: false
              })
            }
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
          onChange={e =>
            editSet(ei, si, {
              reps: e.target.value === '' ? null : Number(e.target.value),
              done: false
            })
          }
        />
      </div>

      <div className="set-input-cell rpe-cell">
        <RpeControl
          compact
          name={`rir-${exercise.id}-${si}`}
          ariaLabel={`${exercise.name} set ${si + 1} RIR`}
          value={set.rir === '5+' ? 5 : (set.rpe !== null ? Math.round(10 - set.rpe) : null)}
          disabled={set.done}
          onChange={value =>
            editSet(ei, si, {
              rpe: value !== null ? (value >= 5 ? null : 10 - value) : null,
              rir: value !== null ? (value >= 5 ? '5+' : String(value)) : null,
              done: false
            })
          }
        />
      </div>

      <div className="set-action-cell log-cell">
        <Button
          presentation="plain"
          className={`set-log-checkbox ${set.done ? 'checked' : ''}`}
          aria-label={`${set.done ? 'Unlog' : 'Log'} ${exercise.name} set ${si + 1}`}
          aria-pressed={set.done}
          onClick={() => toggle(ei, si)}
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
