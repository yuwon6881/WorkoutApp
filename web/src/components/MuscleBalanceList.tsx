import type { CSSProperties } from 'react';
import type { MuscleBalanceRow } from '../types';
import { formatSets, shadeFor } from '../lib/muscleBalance';

function setCountLabel(sets: number) {
  const count = formatSets(sets);
  return `${count} ${sets === 1 ? 'set' : 'sets'}`;
}

/// Only the muscles that were trained get a row. Untrained ones are named once underneath instead
/// of repeating an empty row for every muscle in the catalog.
export function MuscleBalanceList({
  muscles,
  peak,
  dateLabel,
  activeMuscle,
  onHoverMuscle,
  onSelectMuscle
}: {
  muscles: MuscleBalanceRow[];
  peak: number;
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
        <span role="columnheader">Last trained</span>
      </div>
      <div className="muscle-balance-table-body" role="rowgroup">
        {muscles.map(muscle => {
          const isActive = activeMuscle === muscle.muscle;
          const barStyle = { '--muscle-bar': `${Math.round(shadeFor(muscle.sets, peak) * 100)}%` } as CSSProperties;
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
                <span>{muscle.muscle}</span>
                <span className="muscle-balance-bar" style={barStyle} aria-hidden="true" />
              </span>
              <span className="muscle-balance-cell muscle-balance-sets" role="cell" data-label="Credited sets">
                <strong>{setCountLabel(muscle.sets)}</strong>
                <small>{formatSets(muscle.primarySets)} primary · {formatSets(muscle.secondarySets)} indirect</small>
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
