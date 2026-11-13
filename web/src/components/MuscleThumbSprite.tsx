import { focusViewBox, formatViewBox, MUSCLE_SIDE, parseViewBox } from '../lib/muscleFocus';
import { BACK_PARTS, BACK_REGIONS, BODY_MAP_VIEW_BOX, FRONT_PARTS, FRONT_REGIONS, SILHOUETTE } from './bodyMapPaths';
import './MuscleThumb.css';

const FRAME = parseViewBox(BODY_MAP_VIEW_BOX);
const symbolId = (muscle: string | null) => `muscle-thumb-${(muscle ?? 'body').toLowerCase()}`;

function ThumbSymbol({ muscle }: { muscle: string | null }) {
  const front = !muscle || MUSCLE_SIDE[muscle] === 'front';
  const regions = front ? FRONT_REGIONS : BACK_REGIONS;
  const focus = muscle ? regions[muscle] : undefined;
  const viewBox = muscle && focus
    ? formatViewBox(focusViewBox(muscle, focus, 1, FRAME, { centered: true }))
    : BODY_MAP_VIEW_BOX;
  return (
    <symbol id={symbolId(muscle)} viewBox={viewBox}>
      <path className="muscle-thumb-silhouette" d={SILHOUETTE} />
      <path className="muscle-thumb-part" d={front ? FRONT_PARTS : BACK_PARTS} />
      {Object.entries(regions).map(([name, path]) => (
        <path key={name} className={`muscle-thumb-region${name === muscle ? ' is-highlighted' : ''}`} d={path} />
      ))}
    </symbol>
  );
}

/**
 * One square body-map crop per muscle, drawn once. A long list (the exercise library) then shows each
 * card's muscle with a single <use> instead of repeating every plate's path on every card.
 */
export function MuscleThumbSprite() {
  return (
    <svg className="muscle-thumb-sprite" width="0" height="0" aria-hidden="true" focusable="false">
      <ThumbSymbol muscle={null} />
      {Object.keys(MUSCLE_SIDE).map(muscle => <ThumbSymbol key={muscle} muscle={muscle} />)}
    </svg>
  );
}

/** A square thumbnail from the sprite; null draws the whole figure with nothing highlighted. Decorative. */
export function MuscleThumbUse({ muscle, className }: { muscle: string | null; className?: string }) {
  return (
    <svg className={`muscle-thumb ${className ?? ''}`.trim()} aria-hidden="true" focusable="false">
      <use href={`#${symbolId(muscle)}`} />
    </svg>
  );
}
