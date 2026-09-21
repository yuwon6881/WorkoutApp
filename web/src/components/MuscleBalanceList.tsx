import type { MuscleBalanceRow } from '../types';
import { BAND_LABELS, bandFor, formatSets } from '../lib/muscleBalance';

function setCountLabel(sets: number) {
  const count = formatSets(sets);
  return `${count} ${sets === 1 ? 'set' : 'sets'}`;
}

export function MuscleBalanceList({
  muscles,
  weeks,
  dateLabel,
  activeMuscle,
  onHoverMuscle,
  onSelectMuscle
}: {
  muscles: MuscleBalanceRow[];
  weeks: number;
  dateLabel: (value: string | null) => string;
  activeMuscle?: string | null;
  onHoverMuscle?: (muscle: string | null) => void;
  onSelectMuscle?: (muscle: string) => void;
}) {
  return (
    <div className="muscle-balance-table" role="table" aria-label="Muscle coverage by credited sets">
      <div className="muscle-balance-table-head" role="row">
        <span role="columnheader">Muscle</span>
        <span role="columnheader">Credited sets</span>
        <span role="columnheader">Band</span>
        <span role="columnheader">Last trained</span>
      </div>
      <div className="muscle-balance-table-body" role="rowgroup">
        {muscles.map(muscle => {
          const band = bandFor(muscle.sets, weeks);
          const isActive = activeMuscle === muscle.muscle;
          return (
            <div
              className={`muscle-balance-table-row${isActive ? ' is-active' : ''}`}
              role="row"
              data-muscle={muscle.muscle}
              key={muscle.muscle}
              onMouseEnter={() => onHoverMuscle?.(muscle.muscle)}
              onMouseLeave={() => onHoverMuscle?.(null)}
              onClick={() => onSelectMuscle?.(muscle.muscle)}
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectMuscle?.(muscle.muscle);
                }
              }}
            >
              <span className="muscle-balance-cell muscle-balance-name" role="cell" data-label="Muscle">
                {muscle.muscle}
              </span>
              <span className="muscle-balance-cell muscle-balance-sets" role="cell" data-label="Credited sets">
                <strong>{setCountLabel(muscle.sets)}</strong>
                <small>{formatSets(muscle.primarySets)} primary · {formatSets(muscle.secondarySets)} indirect</small>
              </span>
              <span className="muscle-balance-cell muscle-balance-band-cell" role="cell" data-label="Band">
                <span className={`muscle-balance-band-label band-${band}`}>{BAND_LABELS[band]}</span>
              </span>
              <span className="muscle-balance-cell muscle-balance-last-trained" role="cell" data-label="Last trained">
                <span>{dateLabel(muscle.lastTrainedDate)}</span>
                <small>{muscle.sessions} {muscle.sessions === 1 ? 'workout' : 'workouts'}</small>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
