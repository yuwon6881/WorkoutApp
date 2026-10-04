import { useMemo } from 'react';
import { formatSets, shadeFor } from '../lib/muscleBalance';
import type { PlannedMuscleSummary } from '../lib/programMuscles';
import './ProgramMusclePreview.css';
import { MuscleThumb } from './MuscleThumb';
import { Button } from './ui/Button';

const THUMB_ASPECT = 76 / 64;

/**
 * Ranked muscle tiles for a program day. Clicking a tile notifies the parent via `onMuscleSelect`
 * so the surrounding exercise list can highlight which exercises contribute to that muscle.
 */
export function ProgramMusclePreview({ summary, selectedMuscle, onMuscleSelect }: {
  summary: PlannedMuscleSummary;
  selectedMuscle?: string | null;
  onMuscleSelect?: (muscle: string | null) => void;
}) {
  const peak = summary.muscles[0]?.sets ?? 0;
  const shades = useMemo(
    () => new Map(summary.muscles.map(item => [item.muscle, shadeFor(item.sets, peak)])),
    [summary.muscles, peak]
  );

  return (
    <section className="program-muscle-preview" aria-label="Planned target muscles">
      {summary.muscles.length > 0 ? (
        <ul className="program-muscle-grid" role="list" aria-label="Planned target muscles list">
          {summary.muscles.map(({ muscle, sets }) => {
            const isSelected = selectedMuscle === muscle;
            return (
              <li key={muscle}>
                <Button
                  presentation="plain"
                  className={`program-muscle-tile${isSelected ? ' is-selected' : ''}`}
                  aria-label={`${muscle}, ${formatSets(sets)} planned set ${sets === 1 ? 'credit' : 'credits'}`}
                  aria-pressed={isSelected}
                  onClick={() => onMuscleSelect?.(isSelected ? null : muscle)}
                >
                  <MuscleThumb muscle={muscle} shade={shades.get(muscle) ?? 0} aspect={THUMB_ASPECT}
                    className="program-muscle-figure" />
                  <span className="program-muscle-copy">
                    <strong>{muscle}</strong>
                    <span>{formatSets(sets)} planned set {sets === 1 ? 'credit' : 'credits'}</span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="program-muscle-empty" role="status">
          {summary.unattributedExercises > 0
            ? 'No planned sets could be mapped to a muscle for this day.'
            : 'No working sets are planned for this day.'}
        </p>
      )}
      {summary.unattributedExercises > 0 && summary.muscles.length > 0 && (
        <p className="program-muscle-unattributed" role="status">
          Muscle data is unavailable for {summary.unattributedExercises} {summary.unattributedExercises === 1 ? 'exercise' : 'exercises'}.
        </p>
      )}
    </section>
  );
}
