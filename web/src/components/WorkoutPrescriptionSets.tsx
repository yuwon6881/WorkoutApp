import { Trash2 } from 'lucide-react';
import type { SetPrescription, TemplateExercise } from '../types';
import { Button } from './ui/Button';
import { RepModeToggle, RepPrescriptionControl } from './ui/RepPrescriptionControl';
import { RpeControl } from './ui/RpeControl';
import { SwipeableRow } from './ui/SwipeableRow';
import { WarmupRirNote } from './ui/WarmupRirNote';
import { usesRepRange, withRepMode } from '../lib/repMode';
import './SetPrescriptionGrid.css';

/// The builder's sets as one grid: the column labels are printed once above the rows so each
/// set is a single line on wide screens and two short lines on a phone.
export function WorkoutPrescriptionSets({
  exercise,
  onUpdateSet,
  onRemoveSet
}: {
  exercise: TemplateExercise;
  onUpdateSet: (setIndex: number, patch: Partial<SetPrescription>) => void;
  onRemoveSet: (setIndex: number) => void;
}) {
  const range = usesRepRange(exercise.sets);
  let warmups = 0;
  let working = 0;

  return (
    <div className="set-grid-wrap">
      <div className="set-grid-head">
        <span className="set-grid-head-reps">
          <span aria-hidden="true">Reps</span>
          <RepModeToggle
            range={range}
            label={`Rep target for ${exercise.name}`}
            onChange={next => exercise.sets.forEach((set, si) => onUpdateSet(si, withRepMode(set, next)))}
          />
        </span>
        <span className="set-grid-head-rir" aria-hidden="true">RIR</span>
        <span className="set-grid-head-tempo" aria-hidden="true">Tempo</span>
      </div>
      <ol className="import-sets set-grid-list" aria-label={`Prescription sets for ${exercise.name}`}>
        {exercise.sets.map((set, si) => {
          const number = set.warmup ? ++warmups : ++working;
          const setLabel = `${set.warmup ? 'Warm-up' : 'Set'} ${number}`;
          const removeAction = (
            <Button
              variant="destructive"
              className="import-set-remove"
              aria-label={`Remove ${setLabel.toLowerCase()}`}
              disabled={exercise.sets.length <= 1}
              onClick={() => onRemoveSet(si)}
            >
              <Trash2 size={15} />
              <span className="sr-only">Delete</span>
            </Button>
          );

          return (
            <li className={`import-set ${set.warmup ? 'warmup-row' : ''}`} key={si}>
              <SwipeableRow
                className="import-set-swipe-row"
                actions={removeAction}
                desktopActions={removeAction}
                actionsWidth={72}
                actionsLabel={`Actions for ${setLabel.toLowerCase()}`}
              >
                <div className="import-set-content set-grid-row">
                  <div className="import-set-heading">
                    <span className={`set-number ${set.warmup ? 'set-badge-warmup' : ''}`}>
                      <span className="set-number-label">{set.warmup ? 'Warm-up' : 'Set'}</span>
                      <strong>{number}</strong>
                    </span>
                    <Button
                      variant="tertiary"
                      className={`set-warmup-chip ${set.warmup ? 'active' : ''}`}
                      aria-pressed={set.warmup}
                      aria-label={`Warm-up for ${exercise.name} set ${si + 1}`}
                      onClick={() =>
                        onUpdateSet(si, {
                          warmup: !set.warmup,
                          targetRpe: set.warmup ? set.targetRpe ?? 8 : null,
                          rir: set.warmup ? set.rir : null
                        })
                      }
                    >
                      <span>Warm-up</span>
                    </Button>
                  </div>
                  <div className="import-set-fields">
                    <RepPrescriptionControl
                      repMin={set.repMin}
                      repMax={set.repMax}
                      range={range}
                      nameMin={`workout-rep-min-${exercise.id}-${si}`}
                      nameMax={`workout-rep-max-${exercise.id}-${si}`}
                      nameSingle={`workout-rep-${exercise.id}-${si}`}
                      labelPrefix={`${exercise.name} set ${si + 1}`}
                      onChange={({ repMin, repMax }) => onUpdateSet(si, { repMin, repMax })}
                    />
                    {set.warmup ? <WarmupRirNote compact /> : (
                      <div className="field rpe-field">
                        <span>Target RIR</span>
                        <RpeControl
                          name={`target-rir-${exercise.id}-${si}`}
                          ariaLabel={`${exercise.name} set ${si + 1} target RIR`}
                          value={targetRir(set)}
                          onChange={val =>
                            onUpdateSet(si, {
                              targetRpe: val !== null ? (val >= 5 ? 6 : 10 - val) : null,
                              rir: val !== null ? (val >= 5 ? '5+' : String(val)) : null
                            })
                          }
                        />
                      </div>
                    )}
                    <label className="field set-tempo-field">
                      <span>Tempo</span>
                      <input
                        name={`workout-tempo-${exercise.id}-${si}`}
                        aria-label={`${exercise.name} set ${si + 1} tempo`}
                        placeholder="3010"
                        inputMode="numeric"
                        value={set.tempo ?? ''}
                        onChange={e => onUpdateSet(si, { tempo: e.target.value || null })}
                      />
                    </label>
                  </div>
                </div>
              </SwipeableRow>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function targetRir(set: SetPrescription): number | null {
  if (set.rir === '5+' || (set.rir && Number(set.rir) >= 5)) return 5;
  if (set.rir && Number.isFinite(Number(set.rir))) return Math.round(Number(set.rir));
  return set.targetRpe !== null ? Math.round(10 - set.targetRpe) : null;
}
