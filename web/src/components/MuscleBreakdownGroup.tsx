import { useEffect, useState } from 'react';
import type { MuscleBalanceRow } from '../types';
import { formatSets, shadeFor } from '../lib/muscleBalance';
import { MuscleThumb } from './MuscleThumb';
import { Button } from './ui/Button';

export function MuscleBreakdownGroup({ title, muscles, peak, activeMuscle, onSelect, onHover, onExercise }: {
  title: string;
  muscles: MuscleBalanceRow[];
  peak: number;
  activeMuscle: string | null;
  onSelect: (muscle: string) => void;
  onHover: (muscle: string | null) => void;
  onExercise: (id: string) => void;
}) {
  const total = muscles.reduce((sum, muscle) => sum + muscle.sets, 0);
  const trained = muscles.filter(muscle => muscle.sets > 0);
  // With anything trained, untrained muscles fold away below it; a group with nothing trained
  // still lists every muscle, so there is something to select.
  const untrained = trained.length ? muscles.filter(muscle => muscle.sets <= 0) : [];
  const shown = trained.length ? trained : muscles;
  const [untrainedOpen, setUntrainedOpen] = useState(false);
  const activeIsFolded = untrained.some(muscle => muscle.muscle === activeMuscle);
  useEffect(() => {
    if (activeIsFolded) setUntrainedOpen(true);
  }, [activeIsFolded]);

  const row = (muscle: MuscleBalanceRow) => {
    const selected = activeMuscle === muscle.muscle;
    const pct = peak > 0 ? muscle.sets / peak * 100 : 0;
    return <li key={muscle.muscle} data-breakdown-muscle={muscle.muscle}>
      <Button presentation="plain"
        className={`muscle-breakdown-item${muscle.sets > 0 ? '' : ' is-untrained'}${selected ? ' is-active' : ''}`}
        aria-label={`${muscle.muscle}, ${formatSets(muscle.sets)} sets, contributing lifts`}
        aria-expanded={selected}
        onClick={() => onSelect(muscle.muscle)}
        onMouseEnter={() => onHover(muscle.muscle)} onMouseLeave={() => onHover(null)}>
        <MuscleThumb muscle={muscle.muscle} shade={shadeFor(muscle.sets, peak)} aspect={1}
          className="muscle-breakdown-figure" />
        <span className="muscle-breakdown-copy">
          <span className="muscle-breakdown-row">
            <span className="muscle-breakdown-name">{muscle.muscle}</span>
            <span className="muscle-breakdown-sets"><strong>{formatSets(muscle.sets)}</strong> <small>{muscle.sets === 1 ? 'set' : 'sets'}</small></span>
          </span>
          <span className="muscle-breakdown-track" aria-hidden="true">
            <span className="muscle-breakdown-fill" style={{ width: `${muscle.sets > 0 ? Math.max(pct, 4) : 0}%` }} />
          </span>
        </span>
      </Button>
      {selected && <div className="muscle-contributions" aria-label={`${muscle.muscle} contributing lifts`}>
        {(muscle.contributions ?? []).length > 0 ? muscle.contributions!.map((lift, index) => (
          lift.exerciseId ? <Button variant="tertiary" className="muscle-contribution" key={lift.exerciseId}
            onClick={() => onExercise(lift.exerciseId!)}>
            <span>{lift.name}</span><small>{formatSets(lift.sets)} set credits</small>
          </Button> : <p className="muscle-contribution" key={`unlinked-${index}`}>
            <span>{lift.name}<small>Exercise library link unavailable</small></span>
            <small>{formatSets(lift.sets)} set credits</small>
          </p>
        )) : <p className="muted">{muscle.sets > 0 ? 'Contributing lifts unavailable. Refresh coverage to try again.' : 'No contributing lifts in this window.'}</p>}
      </div>}
    </li>;
  };

  return <div className="muscle-breakdown-group">
    <div className="muscle-group-header">
      <h3>{title}</h3>
      <span className={`pill ${total > 0 ? 'pill-accent' : 'pill-muted'}`}>{formatSets(total)} {total === 1 ? 'set' : 'sets'}</span>
    </div>
    <ul className="muscle-breakdown-list">
      {shown.map(row)}
    </ul>
    {untrained.length > 0 && <details className="muscle-breakdown-untrained" open={untrainedOpen}
      onToggle={event => setUntrainedOpen(event.currentTarget.open)}>
      <summary>{untrained.length} untrained</summary>
      <ul className="muscle-breakdown-list">
        {untrained.map(row)}
      </ul>
    </details>}
  </div>;
}
