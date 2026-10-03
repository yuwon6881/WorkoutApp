import { useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import type { LoggedSet, Preferences, SessionExercise, SetPrescription } from '../types';
import { defaultLoadStepKg, showTarget, showWeight, toDisplay, toKg } from '../lib/training';
import { effortPatch, effortValue, loadIsEditable, setNumberLabel } from '../lib/workoutDraft';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { RepsRirControl } from './ui/RepsRirControl';
import { SetTypeSelect } from './ui/SetTypeSelect';
import { SwipeableRow } from './ui/SwipeableRow';
import { useWindowTier } from '../lib/breakpoints';
import type { SetType } from '../lib/importSetTypes';
import { sessionSetType } from '../lib/workoutSetTypes';
import { nextAvailableLoad } from '../lib/exerciseLoads';
import { partialTechniqueLabel } from '../lib/importSetTypes';
import { isTimedExercise, showTimedTarget, timedTargetSeconds } from '../lib/setDuration';
import { discardStopwatch } from '../lib/setStopwatch';
import { WorkoutSetTimeCell } from './WorkoutSetTimeCell';
import { useTrackRir } from '../lib/trackRir';

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
  previous,
  unit,
  loadStepKg: resolvedStepKg,
  availableLoadsKg,
  editSet,
  toggle,
  setTypes,
  onSetType,
  onRemoveSet
}: {
  set: LoggedSet;
  si: number;
  ei: number;
  exercise: SessionExercise;
  plan: SetPrescription | undefined;
  /** What this set read last time; when absent the plan's target is shown instead. */
  previous?: string | null;
  unit: Preferences['unit'];
  loadStepKg?: number;
  availableLoadsKg?: number[] | null;
  editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void;
  toggle: (ei: number, si: number) => void;
  /** The types this set may take here (warm-ups stay a leading block). */
  setTypes: SetType[];
  onSetType: (si: number, type: SetType) => void;
  onRemoveSet: (si: number) => void;
}) {
  // Set only by the tap that logs a set, so rows already done do not replay it when shown again.
  const trackRir = useTrackRir();
  const [justLogged, setJustLogged] = useState(false);
  const shown = toDisplay(set.weightKg, unit);
  const stepKg = resolvedStepKg ?? defaultLoadStepKg(unit);
  const { label, warmup } = setNumberLabel(exercise, si);
  const loadModel = exercise.loadModel ?? 'external';
  const loadEditable = loadIsEditable(exercise, set);
  const partialTechnique = plan ? partialTechniqueLabel(plan) : null;
  const timed = isTimedExercise(exercise);
  const type = sessionSetType(set, plan);
  // Phones hide delete behind a sideways swipe on the row; wider layouts keep it at the row's end.
  const compact = useWindowTier() === 'compact';
  const setName = `${exercise.name} set ${si + 1}`;
  const removable = exercise.sets.length > 1;
  const remove = () => {
    discardStopwatch(set.id);
    onRemoveSet(si);
  };

  const row = (
    <div
      className={`workout-set-row ${set.done ? 'done' : ''} ${warmup ? 'warmup-row' : ''} ${
        set.suggestion ? 'has-suggestion' : ''
      } ${justLogged ? 'just-logged' : ''} ${timed ? 'timed-row' : ''}`}
      onAnimationEnd={event => { if (event.target === event.currentTarget) setJustLogged(false); }}
    >
      <SetTypeSelect
        compact
        name={`set-type-${exercise.id}-${si}`}
        ariaLabel={`Set type for ${setName}`}
        type={type}
        number={Number(label.replace(/\D/g, '')) || si + 1}
        types={setTypes}
        onChange={next => onSetType(si, next)}
      />

      <div className="set-target-cell">
        <span className="target-text" title={previous ? 'The same set last time' : undefined}>{previous ?? (plan ? (timed ? showTimedTarget(plan) : showTarget(plan, trackRir)) : '—')}</span>
        {partialTechnique && <small className="set-technique-note">{partialTechnique}</small>}
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
          step={availableLoadsKg?.length || stepKg <= 0 ? 'any' : toDisplay(stepKg, unit) ?? 'any'}
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            const next = availableLoadsKg?.length
              ? nextAvailableLoad(set.weightKg, availableLoadsKg, direction)
              : Math.max(0, (set.weightKg ?? 0) + direction * stepKg);
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

      {timed ? (
        // Reps in reserve has no meaning for a hold, so the time spans the reps and RIR columns.
        <WorkoutSetTimeCell
          set={set}
          label={`${exercise.name} set ${si + 1}`}
          targetSeconds={timedTargetSeconds(plan)}
          onChange={durationSeconds => editSet(ei, si, { durationSeconds })}
        />
      ) : (
        <RepsRirControl name={`reps-${exercise.id}-${si}`} label={`${exercise.name} set ${si + 1}`}
          reps={set.reps} rir={effortValue(set)} trackRir={trackRir}
          onChange={(reps, rir) => editSet(ei, si, { reps, ...(trackRir ? effortPatch(rir) : {}) })} />
      )}

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

      {!compact && <div className="set-action-cell del-cell">
        <Button
          variant="tertiary"
          className="set-del-btn"
          aria-label={`Remove ${setName}`}
          title="Delete set"
          disabled={!removable}
          onClick={remove}
        >
          <Trash2 size={16} />
        </Button>
      </div>}
    </div>
  );

  if (!compact || !removable) return row;
  return (
    <SwipeableRow
      adaptive
      className="workout-set-swipe"
      actionsWidth={80}
      peek={si === 0}
      actionsLabel={`Actions for ${setName}`}
      actions={(
        <Button variant="destructive" aria-label={`Remove ${setName}`} onClick={remove}>
          <Trash2 size={16} />
          <span>Delete</span>
        </Button>
      )}
    >
      {row}
    </SwipeableRow>
  );
}
