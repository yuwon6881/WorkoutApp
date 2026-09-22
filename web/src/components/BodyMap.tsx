import type { CSSProperties } from 'react';
import type { MuscleBalanceRow } from '../types';
import { formatSets, shadeFor } from '../lib/muscleBalance';
import './BodyMap.css';
import {
  BACK_ANATOMY_LINES, BACK_REGIONS, BACK_SILHOUETTE, BODY_MAP_VIEW_BOX,
  FRONT_ANATOMY_LINES, FRONT_REGIONS, FRONT_SILHOUETTE
} from './bodyMapPaths';

type BodyMapProps = {
  muscles: MuscleBalanceRow[];
  peak: number;
  activeMuscle?: string | null;
  onHoverMuscle?: (muscle: string | null) => void;
  onSelectMuscle?: (muscle: string) => void;
};

/// The fill is one accent hue at a depth proportional to the muscle's share of the busiest muscle,
/// so a deeper region simply means more credited sets.
function fillStyle(shade: number): CSSProperties {
  const depth = Math.round(25 + 65 * shade);
  return { '--muscle-shade': `${depth}%` } as CSSProperties;
}

function makeAccessibleLabel(view: string, regions: Record<string, string>, muscles: MuscleBalanceRow[]): string {
  const visibleRegions = new Set(Object.keys(regions));
  const trained = muscles
    .filter(muscle => visibleRegions.has(muscle.muscle) && muscle.sets > 0)
    .sort((left, right) => right.sets - left.sets || left.muscle.localeCompare(right.muscle));
  const untrained = muscles
    .filter(muscle => visibleRegions.has(muscle.muscle) && muscle.sets <= 0)
    .map(muscle => muscle.muscle);
  const top = trained.slice(0, 3)
    .map(muscle => `${muscle.muscle}, ${formatSets(muscle.sets)} sets`)
    .join('; ') || 'none';

  return `${view} body heat map. Most trained: ${top}. Not trained: ${untrained.join(', ') || 'none'}.`;
}

function BodyFigure({ view, regions, anatomyLines, silhouette, muscles, peak, activeMuscle, onHoverMuscle, onSelectMuscle }: {
  view: 'Front' | 'Back';
  regions: Record<string, string>;
  anatomyLines: string;
  silhouette: string;
  muscles: MuscleBalanceRow[];
  peak: number;
  activeMuscle?: string | null;
  onHoverMuscle?: (muscle: string | null) => void;
  onSelectMuscle?: (muscle: string) => void;
}) {
  const values = new Map(muscles.map(muscle => [muscle.muscle, muscle.sets]));

  return (
    <figure className="body-map-diagram">
      <figcaption>{view}</figcaption>
      <svg
        className="body-map-figure"
        viewBox={BODY_MAP_VIEW_BOX}
        role="img"
        aria-label={makeAccessibleLabel(view, regions, muscles)}
        focusable="false"
      >
        <path className="body-map-silhouette" d={silhouette} aria-hidden="true" />
        {Object.entries(regions).map(([muscle, path]) => {
          const sets = values.get(muscle) ?? 0;
          const isActive = activeMuscle === muscle;
          return (
            <path
              key={muscle}
              className={`muscle-region${sets > 0 ? '' : ' is-untrained'}${isActive ? ' is-active' : ''}`}
              style={fillStyle(shadeFor(sets, peak))}
              data-muscle={muscle}
              d={path}
              role="button"
              tabIndex={0}
              aria-label={sets > 0 ? `${muscle}: ${formatSets(sets)} credited sets` : `${muscle}: not trained`}
              aria-pressed={isActive}
              onMouseEnter={() => onHoverMuscle?.(muscle)}
              onMouseLeave={() => onHoverMuscle?.(null)}
              onFocus={() => onHoverMuscle?.(muscle)}
              onClick={() => onSelectMuscle?.(muscle)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectMuscle?.(muscle);
                }
              }}
            />
          );
        })}
        <path className="muscle-anatomy-lines" d={anatomyLines} aria-hidden="true" />
      </svg>
    </figure>
  );
}

export function BodyMap({ muscles, peak, activeMuscle, onHoverMuscle, onSelectMuscle }: BodyMapProps) {
  return (
    <div className="body-map-pair">
      <BodyFigure
        view="Front"
        regions={FRONT_REGIONS}
        anatomyLines={FRONT_ANATOMY_LINES}
        silhouette={FRONT_SILHOUETTE}
        muscles={muscles}
        peak={peak}
        activeMuscle={activeMuscle}
        onHoverMuscle={onHoverMuscle}
        onSelectMuscle={onSelectMuscle}
      />
      <BodyFigure
        view="Back"
        regions={BACK_REGIONS}
        anatomyLines={BACK_ANATOMY_LINES}
        silhouette={BACK_SILHOUETTE}
        muscles={muscles}
        peak={peak}
        activeMuscle={activeMuscle}
        onHoverMuscle={onHoverMuscle}
        onSelectMuscle={onSelectMuscle}
      />
    </div>
  );
}

/// A fixed slot under the figures. It reads out whichever muscle is hovered, focused or tapped, and
/// never changes the page height, so pointing at a region cannot move the region out from under the
/// pointer.
export function MuscleDetail({ muscle, dateLabel }: {
  muscle: MuscleBalanceRow | null;
  dateLabel: (value: string | null) => string;
}) {
  return (
    <div className="body-map-detail" role="status" aria-live="polite">
      {muscle ? <>
        <strong className="body-map-detail-name">{muscle.muscle}</strong>
        <span className="body-map-detail-sets">
          {formatSets(muscle.sets)} {muscle.sets === 1 ? 'set' : 'sets'}
        </span>
        <span className="body-map-detail-split">
          {formatSets(muscle.primarySets)} primary · {formatSets(muscle.secondarySets)} indirect
        </span>
        <span className="body-map-detail-last">
          {muscle.sets > 0 ? `Last trained ${dateLabel(muscle.lastTrainedDate)}` : 'Not trained in this window'}
        </span>
      </> : <span className="body-map-detail-hint">Select a muscle to see its sets</span>}
    </div>
  );
}
