import type { CSSProperties } from 'react';
import { formatSets, shadeFor } from '../lib/muscleBalance';
import type { PlannedMuscleSummary } from '../lib/programMuscles';
import './ProgramMusclePreview.css';
import { BACK_PARTS, BACK_REGIONS, FRONT_PARTS, FRONT_REGIONS } from './bodyMapPaths';

type BodySide = 'front' | 'back';
type MuscleCrop = { side: BodySide; viewBox: string };

const MUSCLE_CROPS: Record<string, MuscleCrop> = {
  Neck: { side: 'front', viewBox: '58 42 84 42' },
  Traps: { side: 'back', viewBox: '43 56 114 68' },
  Shoulders: { side: 'front', viewBox: '29 70 142 70' },
  Chest: { side: 'front', viewBox: '36 72 128 72' },
  Back: { side: 'back', viewBox: '38 78 124 124' },
  Biceps: { side: 'front', viewBox: '24 100 152 78' },
  Triceps: { side: 'back', viewBox: '24 104 152 78' },
  Forearms: { side: 'front', viewBox: '16 174 168 74' },
  Core: { side: 'front', viewBox: '37 116 126 96' },
  Glutes: { side: 'back', viewBox: '36 188 128 76' },
  Quads: { side: 'front', viewBox: '34 190 132 120' },
  Hamstrings: { side: 'back', viewBox: '34 236 132 78' },
  Adductors: { side: 'front', viewBox: '42 198 116 76' },
  Calves: { side: 'back', viewBox: '42 310 116 86' }
};

function TargetMuscleFigure({ muscle, shade }: { muscle: string; shade: number }) {
  const crop = MUSCLE_CROPS[muscle];
  const regions = crop.side === 'front' ? FRONT_REGIONS : BACK_REGIONS;
  const parts = crop.side === 'front' ? FRONT_PARTS : BACK_PARTS;
  const shadePercent = Math.round(35 + 60 * shade);
  const highlightedStyle = { '--muscle-shade': `${shadePercent}%` } as CSSProperties;

  return (
    <svg className="program-muscle-figure" viewBox={crop.viewBox} aria-hidden="true" focusable="false">
      <path className="program-muscle-part" d={parts} />
      {Object.entries(regions).map(([name, path]) => (
        <path
          key={name}
          className={`program-muscle-region${name === muscle ? ' is-highlighted' : ''}`}
          style={name === muscle ? highlightedStyle : undefined}
          d={path}
        />
      ))}
    </svg>
  );
}

export function ProgramMusclePreview({ summary }: { summary: PlannedMuscleSummary }) {
  const peak = summary.muscles[0]?.sets ?? 0;

  return (
    <section className="program-muscle-preview" aria-label="Planned target muscles">
      <h3>Planned target muscles</h3>
      {summary.muscles.length > 0 ? (
        <ul className="program-muscle-grid">
          {summary.muscles.map(({ muscle, sets }) => (
            <li className="program-muscle-tile" key={muscle}>
              <TargetMuscleFigure muscle={muscle} shade={shadeFor(sets, peak)} />
              <div className="program-muscle-copy">
                <strong>{muscle}</strong>
                <span>{formatSets(sets)} planned set {sets === 1 ? 'credit' : 'credits'}</span>
              </div>
            </li>
          ))}
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
