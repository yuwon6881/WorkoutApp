import type { MuscleBalanceRow } from '../types';
import { bandFor, formatSets } from '../lib/muscleBalance';
import './BodyMap.css';
import { BACK_REGIONS, BODY_MAP_SILHOUETTE, BODY_MAP_VIEW_BOX, FRONT_REGIONS } from './bodyMapPaths';

type BodyMapProps = {
  muscles: MuscleBalanceRow[];
  weeks: number;
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

function BodyFigure({ view, regions, muscles, weeks }: {
  view: 'Front' | 'Back';
  regions: Record<string, string>;
  muscles: MuscleBalanceRow[];
  weeks: number;
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
        <path className="body-map-silhouette" d={BODY_MAP_SILHOUETTE} aria-hidden="true" />
        {Object.entries(regions).map(([muscle, path]) => {
          const band = bandFor(values.get(muscle) ?? 0, weeks);
          return (
            <path
              key={muscle}
              className={`muscle-region band-${band}`}
              data-muscle={muscle}
              d={path}
              aria-hidden="true"
            />
          );
        })}
      </svg>
    </figure>
  );
}

export function BodyMap({ muscles, weeks }: BodyMapProps) {
  return (
    <div className="body-map-pair">
      <BodyFigure view="Front" regions={FRONT_REGIONS} muscles={muscles} weeks={weeks} />
      <BodyFigure view="Back" regions={BACK_REGIONS} muscles={muscles} weeks={weeks} />
    </div>
  );
}
