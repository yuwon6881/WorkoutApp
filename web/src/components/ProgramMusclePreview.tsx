import { useMemo, type CSSProperties } from 'react';
import { formatSets, shadeFor } from '../lib/muscleBalance';
import {
  focusViewBox, formatViewBox, MUSCLE_SIDE, parseViewBox, type BodySide, type ViewBox
} from '../lib/muscleFocus';
import type { PlannedMuscleSummary } from '../lib/programMuscles';
import './ProgramMusclePreview.css';
import { BACK_PARTS, BACK_REGIONS, BODY_MAP_VIEW_BOX, FRONT_PARTS, FRONT_REGIONS } from './bodyMapPaths';
import { Button } from './ui/Button';

const FRAME = parseViewBox(BODY_MAP_VIEW_BOX);
const THUMB_ASPECT = 76 / 64;

const figureFor = (side: BodySide) => side === 'front'
  ? { regions: FRONT_REGIONS, parts: FRONT_PARTS }
  : { regions: BACK_REGIONS, parts: BACK_PARTS };

function cropFor(muscle: string, aspect: number): { side: BodySide; box: ViewBox } {
  const side = MUSCLE_SIDE[muscle] ?? 'front';
  const path = figureFor(side).regions[muscle];
  return { side, box: path ? focusViewBox(muscle, path, aspect, FRAME, { centered: true }) : FRAME };
}

/// One accent hue at a depth proportional to the muscle's share of the day's busiest muscle.
const shadeStyle = (shade: number) => ({ '--muscle-shade': `${Math.round(35 + 60 * shade)}%` } as CSSProperties);

function MuscleFigure({ side, viewBox, focus, shades, className }: {
  side: BodySide;
  viewBox: string;
  focus: string;
  shades: Map<string, number>;
  className: string;
}) {
  const { regions, parts } = figureFor(side);
  return (
    <svg className={className} viewBox={viewBox} aria-hidden="true" focusable="false">
      <path className="program-muscle-part" d={parts} />
      {Object.entries(regions).map(([name, path]) => {
        const shade = shades.get(name);
        const state = name === focus ? ' is-highlighted' : shade !== undefined ? ' is-context' : '';
        return <path key={name} className={`program-muscle-region${state}`}
          style={shade !== undefined ? shadeStyle(shade) : undefined} d={path} />;
      })}
    </svg>
  );
}

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
            const thumb = cropFor(muscle, THUMB_ASPECT);
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
                  <MuscleFigure side={thumb.side} viewBox={formatViewBox(thumb.box)} focus={muscle}
                    shades={new Map([[muscle, shades.get(muscle) ?? 0]])} className="program-muscle-figure" />
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
