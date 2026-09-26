import { useState } from 'react';
import { Disc3, Minus, TrendingUp } from 'lucide-react';
import type { LoggedSet, Preferences, SessionExercise, SetPrescription } from '../types';
import { showTarget, showWeight, toDisplay, toKg } from '../lib/training';
import { effortPatch, effortValue, loadIsEditable, setNumberLabel } from '../lib/workoutDraft';
import { Button } from './ui/Button';
import { NumberStepper } from './ui/NumberStepper';
import { RirChips } from './ui/RpeControl';
import { Select } from './ui/Select';
import { resistanceModeOptions } from './WorkoutSetRow';
import { PlateCalculator } from './PlateCalculator';
import './WorkoutSetCard.css';

/// The set about to be logged, drawn large for a thumb: load and reps on steppers, effort as one
/// tap, and the suggestion's reason in words rather than a hover-only tooltip. It is logged from
/// the footer's primary action, which stays in the same place for every set.
export function WorkoutSetCard({
  set,
  si,
  ei,
  exercise,
  plan,
  unit,
  loadStepKg,
  barbell = false,
  editSet,
  onRemoveSet
}: {
  set: LoggedSet;
  si: number;
  ei: number;
  exercise: SessionExercise;
  plan: SetPrescription | undefined;
  unit: Preferences['unit'];
  loadStepKg: number;
  /** A barbell movement, which gets a plates-per-side helper for its load. */
  barbell?: boolean;
  editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void;
  onRemoveSet: (si: number) => void;
}) {
  const { label, warmup } = setNumberLabel(exercise, si);
  const loadEditable = loadIsEditable(exercise, set);
  const displayStep = toDisplay(loadStepKg, unit) ?? loadStepKg;
  const [platesOpen, setPlatesOpen] = useState(false);

  return (
    <div className={`workout-set-card ${warmup ? 'warmup-row' : ''}`} aria-label={`${warmup ? 'Warm-up' : 'Set'} ${label}, ready to log`} role="group">
      <div className="set-card-head">
        <span className="set-badge-circle" aria-hidden="true">{label}</span>
        <div className="set-card-target">
          <span className="set-card-title">{warmup ? `Warm-up ${label.slice(1)}` : `Set ${label}`}</span>
          <span className="target-text">{plan ? showTarget(plan) : 'No target'}</span>
        </div>
        <Button
          variant="tertiary"
          className="set-del-btn"
          aria-label={`Remove ${exercise.name} set ${si + 1}`}
          disabled={exercise.sets.length <= 1}
          onClick={() => onRemoveSet(si)}
        >
          <Minus size={16} />
        </Button>
      </div>

      {set.suggestion && (
        <p className="set-card-suggestion">
          <TrendingUp size={15} aria-hidden="true" />
          <span>
            {set.suggestion.suggestedLoadKg != null && <strong>{showWeight(set.suggestion.suggestedLoadKg, unit)}. </strong>}
            {set.suggestion.reason}
          </span>
        </p>
      )}

      <div className="set-card-inputs">
        <div className="set-card-field">
          <span className="set-card-label-row">
            <span className="set-card-label" aria-hidden="true">{loadEditable ? `Load (${unit})` : 'Load'}</span>
            {barbell && loadEditable && (
              <Button variant="tertiary" className="set-card-plates" onClick={() => setPlatesOpen(true)}>
                <Disc3 size={15} aria-hidden="true" />Plates
              </Button>
            )}
          </span>
          <NumberStepper
            name={`weight-${exercise.id}-${si}`}
            ariaLabel={`${exercise.name} set ${si + 1} weight`}
            unit={unit}
            value={toDisplay(set.weightKg, unit)}
            step={displayStep}
            decimals={unit === 'lb' ? 1 : 2}
            max={unit === 'lb' ? 2200 : 1000}
            disabled={!loadEditable}
            placeholder={loadEditable ? '—' : 'BW'}
            onChange={value => editSet(ei, si, { weightKg: value === null ? null : toKg(value, unit) })}
          />
          {(exercise.loadModel ?? 'external') === 'full_bodyweight' && (
            <Select
              className="mode-mini-select"
              ariaLabel="Resistance mode"
              value={set.resistanceMode ?? 'bodyweight'}
              options={resistanceModeOptions}
              onChange={value => editSet(ei, si, { resistanceMode: value })}
            />
          )}
        </div>
        <div className="set-card-field">
          <span className="set-card-label" aria-hidden="true">Reps</span>
          <NumberStepper
            name={`reps-${exercise.id}-${si}`}
            ariaLabel={`${exercise.name} set ${si + 1} reps`}
            value={set.reps}
            step={1}
            min={1}
            max={1000}
            decimals={0}
            onChange={value => editSet(ei, si, { reps: value })}
          />
        </div>
      </div>

      <div className="set-card-field">
        <span className="set-card-label">Reps in reserve</span>
        <RirChips
          ariaLabel={`${exercise.name} set ${si + 1} RIR`}
          value={effortValue(set)}
          onChange={value => editSet(ei, si, effortPatch(value))}
        />
      </div>
      {platesOpen && <PlateCalculator total={toDisplay(set.weightKg, unit)} unit={unit} onClose={() => setPlatesOpen(false)} />}
    </div>
  );
}
