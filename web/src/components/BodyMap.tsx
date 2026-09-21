import type { MuscleBalanceRow } from '../types';
import { BAND_LABELS, bandFor, formatSets } from '../lib/muscleBalance';
import './BodyMap.css';
import { BACK_REGIONS, BODY_MAP_SILHOUETTE, BODY_MAP_VIEW_BOX, FRONT_REGIONS } from './bodyMapPaths';

type BodyMapProps = {
  muscles: MuscleBalanceRow[];
  weeks: number;
  activeMuscle?: string | null;
  onHoverMuscle?: (muscle: string | null) => void;
  onSelectMuscle?: (muscle: string) => void;
};

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

function BodyFigure({ view, regions, muscles, weeks, activeMuscle, onHoverMuscle, onSelectMuscle }: {
  view: 'Front' | 'Back';
  regions: Record<string, string>;
  muscles: MuscleBalanceRow[];
  weeks: number;
  activeMuscle?: string | null;
  onHoverMuscle?: (muscle: string | null) => void;
  onSelectMuscle?: (muscle: string) => void;
}) {
  const values = new Map(muscles.map(muscle => [muscle.muscle, muscle.sets]));
  const activeSets = activeMuscle && values.has(activeMuscle) ? values.get(activeMuscle) : null;

  return (
    <figure className="body-map-diagram">
      <figcaption>{view}</figcaption>
      {activeMuscle && regions[activeMuscle] && (
        <div className="body-map-active-callout" role="status">
          <strong>{activeMuscle}</strong>
          <span>· {formatSets(activeSets ?? 0)} {activeSets === 1 ? 'set' : 'sets'}</span>
        </div>
      )}
      <svg
        className="body-map-figure"
        viewBox={BODY_MAP_VIEW_BOX}
        role="img"
        aria-label={makeAccessibleLabel(view, regions, muscles)}
        focusable="false"
      >
        <path className="body-map-silhouette" d={BODY_MAP_SILHOUETTE} aria-hidden="true" />
        {Object.entries(regions).map(([muscle, path]) => {
          const sets = values.get(muscle) ?? 0;
          const band = bandFor(sets, weeks);
          const isActive = activeMuscle === muscle;
          return (
            <path
              key={muscle}
              className={`muscle-region band-${band}${isActive ? ' is-active' : ''}`}
              data-muscle={muscle}
              d={path}
              role="button"
              tabIndex={0}
              aria-label={`${muscle}: ${formatSets(sets)} sets (${BAND_LABELS[band]})`}
              aria-pressed={isActive}
              onMouseEnter={() => onHoverMuscle?.(muscle)}
              onMouseLeave={() => onHoverMuscle?.(null)}
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
      </svg>
    </figure>
  );
}

export function BodyMap({ muscles, weeks, activeMuscle, onHoverMuscle, onSelectMuscle }: BodyMapProps) {
  return (
    <div className="body-map-pair">
      <BodyFigure
        view="Front"
        regions={FRONT_REGIONS}
        muscles={muscles}
        weeks={weeks}
        activeMuscle={activeMuscle}
        onHoverMuscle={onHoverMuscle}
        onSelectMuscle={onSelectMuscle}
      />
      <BodyFigure
        view="Back"
        regions={BACK_REGIONS}
        muscles={muscles}
        weeks={weeks}
        activeMuscle={activeMuscle}
        onHoverMuscle={onHoverMuscle}
        onSelectMuscle={onSelectMuscle}
      />
    </div>
  );
}
