import { useEffect, useState } from 'react';
import { Check, Pause, Trash2 } from 'lucide-react';
import type { LoggedSet, Preferences, SessionExercise, SetPrescription } from '../types';
import { defaultLoadStepKg, showTarget, showWeight, toDisplay, toKg } from '../lib/training';
import { effortPatch, effortValue, loadIsEditable, setNumberLabel } from '../lib/workoutDraft';
import { Button } from './ui/Button';
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
import { WorkoutLoadInput } from './WorkoutLoadInput';
import { useTrackRir } from '../lib/trackRir';
import { loadEntryFor, loadFieldName, loadSign } from '../lib/resistanceVariant';

export function WorkoutSetRow({
  set,
  si,
  ei,
  exercise,
  plan,
  current = false,
  previous,
  unit,
  loadStepKg: resolvedStepKg,
  availableLoadsKg,
  editSet,
  toggle,
  paused,
  setTypes,
  onSetType,
  onRemoveSet
}: {
  set: LoggedSet;
  si: number;
  ei: number;
  exercise: SessionExercise;
  plan: SetPrescription | undefined;
  /** The first set still to log in this exercise, marked as the one the lifter is on. */
  current?: boolean;
  /** What this set read last time; when absent the plan's target is shown instead. */
  previous?: string | null;
  unit: Preferences['unit'];
  loadStepKg?: number;
  availableLoadsKg?: number[] | null;
  editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void;
  toggle: (ei: number, si: number) => void | boolean | Promise<void | boolean>;
  /** While the workout clock is stopped a set can be edited but not newly logged. */
  paused: boolean;
  /** The types this set may take here (warm-ups stay a leading block). */
  setTypes: SetType[];
  onSetType: (si: number, type: SetType) => void;
  onRemoveSet: (si: number) => void;
}) {
  // Set only by the tap that logs a set, so rows already done do not replay it when shown again.
  const trackRir = useTrackRir();
  const [justLogged, setJustLogged] = useState(false);
  const [nudging, setNudging] = useState(false);
  // The marks normally clear when their animation ends; a backgrounded tab sends no animation
  // events, so they also expire, and the next log or nudge can play again.
  useEffect(() => {
    if (!justLogged && !nudging) return;
    const timer = window.setTimeout(() => { setJustLogged(false); setNudging(false); }, 800);
    return () => window.clearTimeout(timer);
  }, [justLogged, nudging]);
  const shown = toDisplay(set.weightKg, unit);
  const stepKg = resolvedStepKg ?? defaultLoadStepKg(unit);
  const { label, warmup } = setNumberLabel(exercise, si);
  const loadEntry = loadEntryFor(exercise);
  const sign = loadSign(loadEntry);
  const loadEditable = loadIsEditable(exercise);
  const partialTechnique = plan ? partialTechniqueLabel(plan) : null;
  const timed = isTimedExercise(exercise);
  const type = sessionSetType(set, plan);
  // Phones hide delete behind a sideways swipe on the row; wider layouts keep it at the row's end.
  const compact = useWindowTier() === 'compact';
  const setName = `${exercise.name} set ${si + 1}`;
  const removable = exercise.sets.length > 1;
  const locked = paused && !set.done;
  const suggestedLoad = set.suggestion?.suggestedLoadKg != null ? showWeight(set.suggestion.suggestedLoadKg, unit) : null;
  const remove = () => {
    discardStopwatch(set.id);
    onRemoveSet(si);
  };

  const triggerNudge = () => {
    setNudging(false);
    window.requestAnimationFrame(() => {
      setNudging(true);
    });
  };

  const row = (
    <div
      className={`workout-set-row ${set.done ? 'done' : ''} ${warmup ? 'warmup-row' : ''} ${
        suggestedLoad ? 'has-suggestion' : ''
      } ${current && !set.done ? 'current' : ''} ${justLogged ? 'just-logged' : ''} ${nudging ? 'nudge' : ''} ${timed ? 'timed-row' : ''}`.replace(/\s+/g, ' ').trim()}
      onAnimationEnd={event => { if (event.target === event.currentTarget) { setJustLogged(false); setNudging(false); } }}
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
        {/* Only a suggested load is worth a line; a suggestion without one would say nothing. */}
        {suggestedLoad && (
          <small className="suggestion-text" title={set.suggestion?.reason}>{suggestedLoad}</small>
        )}
      </div>

      <div className={`set-input-cell load-cell load-${loadEntry}`}>
        {sign && <span className="load-sign" aria-hidden="true">{sign}</span>}
        <WorkoutLoadInput
          name={`weight-${exercise.id}-${si}`}
          ariaLabel={`${exercise.name} set ${si + 1} ${loadFieldName(loadEntry)}`}
          value={shown}
          // A bodyweight movement has no load to enter, so its field stays an empty dash.
          disabled={!loadEditable}
          onStep={direction => {
            const next = availableLoadsKg?.length
              ? nextAvailableLoad(set.weightKg, availableLoadsKg, direction)
              : Math.max(0, (set.weightKg ?? 0) + direction * stepKg);
            editSet(ei, si, { weightKg: next });
          }}
          // Correcting a logged set keeps it logged; only the log button unlogs a set.
          onChange={value => editSet(ei, si, { weightKg: toKg(value, unit) })}
        />
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
          className={`set-log-checkbox ${set.done ? 'checked' : ''} ${locked ? 'paused-lock' : ''}`}
          aria-label={`${set.done ? 'Unlog' : 'Log'} ${exercise.name} set ${si + 1}${locked ? ' (workout paused)' : ''}`}
          aria-pressed={set.done}
          onClick={async () => {
            if (!locked && !set.done && set.reps === null && (set.durationSeconds ?? null) === null) {
              triggerNudge();
              return;
            }
            const res = await toggle(ei, si);
            if (res === false && !set.done) {
              triggerNudge();
            } else if (res !== false && !set.done) {
              setJustLogged(true);
            }
          }}
        >
          {locked ? <Pause size={16} /> : <Check size={18} strokeWidth={set.done ? 3 : 2} />}
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
