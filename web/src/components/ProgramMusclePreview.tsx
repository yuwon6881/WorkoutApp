import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { formatSets, shadeFor } from '../lib/muscleBalance';
import {
  blendViewBox, focusViewBox, formatViewBox, MUSCLE_SIDE, parseViewBox, type BodySide, type ViewBox
} from '../lib/muscleFocus';
import type { PlannedMuscleSummary } from '../lib/programMuscles';
import './ProgramMusclePreview.css';
import { BACK_PARTS, BACK_REGIONS, BODY_MAP_VIEW_BOX, FRONT_PARTS, FRONT_REGIONS } from './bodyMapPaths';
import { Button } from './ui/Button';
import { useReducedMotion } from './ui/Motion';

const FRAME = parseViewBox(BODY_MAP_VIEW_BOX);
const FOCUS_ASPECT = 4 / 3;
const THUMB_ASPECT = 76 / 64;
const ZOOM_MS = 260;

const figureFor = (side: BodySide) => side === 'front'
  ? { regions: FRONT_REGIONS, parts: FRONT_PARTS }
  : { regions: BACK_REGIONS, parts: BACK_PARTS };

function cropFor(muscle: string, aspect: number): { side: BodySide; box: ViewBox } {
  const side = MUSCLE_SIDE[muscle] ?? 'front';
  const path = figureFor(side).regions[muscle];
  return { side, box: path ? focusViewBox(muscle, path, aspect, FRAME) : FRAME };
}

/// One accent hue at a depth proportional to the muscle's share of the day's busiest muscle.
const shadeStyle = (shade: number) => ({ '--muscle-shade': `${Math.round(35 + 60 * shade)}%` } as CSSProperties);

/// Glides the view box between crops so the eye follows the zoom; reduced motion jumps straight there.
function useGlidingViewBox(target: ViewBox, reduced: boolean): ViewBox {
  const [box, setBox] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    if (reduced || typeof requestAnimationFrame === 'undefined') {
      current.current = target;
      setBox(target);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const linear = Math.min(1, (now - started) / ZOOM_MS);
      const eased = 1 - (1 - linear) ** 3;
      current.current = blendViewBox(from, target, eased);
      setBox(current.current);
      if (linear < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);

  return box;
}

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
 * The day's planned muscles: a zoomed figure centred on the selected muscle, with the day's other
 * trained muscles on that side shaded around it, above a ranked list whose entries choose the focus.
 */
export function ProgramMusclePreview({ summary }: { summary: PlannedMuscleSummary }) {
  const peak = summary.muscles[0]?.sets ?? 0;
  const [chosen, setChosen] = useState<string | null>(null);
  const focus = summary.muscles.find(item => item.muscle === chosen) ?? summary.muscles[0] ?? null;
  const reduced = useReducedMotion();
  const shades = useMemo(
    () => new Map(summary.muscles.map(item => [item.muscle, shadeFor(item.sets, peak)])),
    [summary.muscles, peak]
  );
  const focusMuscle = focus?.muscle ?? null;
  const crop = useMemo(
    () => (focusMuscle ? cropFor(focusMuscle, FOCUS_ASPECT) : { side: 'front' as const, box: FRAME }),
    [focusMuscle]
  );
  const glidingBox = useGlidingViewBox(crop.box, reduced);
  const share = focus && peak > 0 ? Math.round((focus.sets / peak) * 100) : 0;

  return (
    <section className="program-muscle-preview" aria-label="Planned target muscles">
      <h3>Planned target muscles</h3>
      {focus ? <>
        <div className="program-muscle-focus">
          <MuscleFigure side={crop.side} viewBox={formatViewBox(glidingBox)} focus={focus.muscle}
            shades={shades} className="program-muscle-focus-figure" />
          <div className="program-muscle-focus-copy" role="status" aria-live="polite">
            <span className="tiny-label">{crop.side === 'front' ? 'Front view' : 'Back view'}</span>
            <strong>{focus.muscle}</strong>
            <span>{formatSets(focus.sets)} planned set {focus.sets === 1 ? 'credit' : 'credits'}</span>
            {focus !== summary.muscles[0] && <span>{share}% of {summary.muscles[0].muscle}</span>}
          </div>
        </div>
        <ul className="program-muscle-grid">
          {summary.muscles.map(({ muscle, sets }) => {
            const thumb = cropFor(muscle, THUMB_ASPECT);
            const selected = muscle === focus.muscle;
            return (
              <li key={muscle}>
                <Button presentation="plain" className={`program-muscle-tile${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected} onClick={() => setChosen(muscle)}
                  aria-label={`${muscle}, ${formatSets(sets)} planned set ${sets === 1 ? 'credit' : 'credits'}`}>
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
      </> : (
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
