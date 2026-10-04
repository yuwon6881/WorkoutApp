import type { CSSProperties } from 'react';
import { focusViewBox, formatViewBox, MUSCLE_SIDE, parseViewBox, type BodySide } from '../lib/muscleFocus';
import { BACK_PARTS, BACK_REGIONS, BODY_MAP_VIEW_BOX, FRONT_PARTS, FRONT_REGIONS } from './bodyMapPaths';
import './MuscleThumb.css';

const FRAME = parseViewBox(BODY_MAP_VIEW_BOX);

const figureFor = (side: BodySide) => side === 'front'
  ? { regions: FRONT_REGIONS, parts: FRONT_PARTS }
  : { regions: BACK_REGIONS, parts: BACK_PARTS };

/// One accent hue at a depth proportional to the muscle's share of the busiest muscle.
const shadeStyle = (shade: number) => ({ '--muscle-shade': `${Math.round(35 + 60 * shade)}%` } as CSSProperties);

/**
 * The body map cropped onto one muscle, drawn on the side where it reads best. Decorative: the
 * caller names the muscle and its sets in text beside it.
 */
export function MuscleThumb({ muscle, shade, aspect, className }: {
  muscle: string;
  /** 0 (lightest) to 1 (the busiest muscle). */
  shade: number;
  /** Width / height of the box the thumbnail is drawn into. */
  aspect: number;
  className?: string;
}) {
  const side = MUSCLE_SIDE[muscle] ?? 'front';
  const { regions, parts } = figureFor(side);
  const focus = regions[muscle];
  const viewBox = focus ? formatViewBox(focusViewBox(muscle, focus, aspect, FRAME, { centered: true })) : BODY_MAP_VIEW_BOX;
  return (
    <svg className={`muscle-thumb ${className ?? ''}`.trim()} viewBox={viewBox} aria-hidden="true" focusable="false">
      <path className="muscle-thumb-part" d={parts} />
      {Object.entries(regions).map(([name, path]) => (
        <path key={name} className={`muscle-thumb-region${name === muscle ? ' is-highlighted' : ''}`}
          style={name === muscle ? shadeStyle(shade) : undefined} d={path} />
      ))}
    </svg>
  );
}
