import { Timer } from 'lucide-react';
import { showClock } from '../lib/training';
import { remainingRestSeconds, restTimer, type RestState } from '../lib/restTimer';
import { REST_OVER_MS, restPhase, restShareLeft } from '../lib/restDisplay';
import { useVisibleClock } from '../lib/useVisibleClock';
import type { RestAction } from '../types';
import { Button } from './ui/Button';

/// The rest countdown, in the trailing half of the workout header's status row. That row keeps its
/// height whether or not a rest runs, so starting or ending a rest never moves the sets below it.
/// The clock drains a track beneath it; a rest that runs out says so for a moment after its chime.
export function WorkoutRestBar({ rest, disabled, nextUp, onRestMutate }: {
  rest: RestState;
  disabled: boolean;
  nextUp: string | null;
  onRestMutate?: (action: RestAction, seconds?: number) => void;
}) {
  const now = useVisibleClock(rest.endsAt > 0 && Date.now() - rest.endsAt < REST_OVER_MS);
  const phase = restPhase(rest, now);
  if (phase === 'idle') return null;
  const remaining = remainingRestSeconds(rest, now);
  const adjust = (action: RestAction, seconds?: number) => () => {
    if (onRestMutate) onRestMutate(action, seconds);
    else if (action === 'skip') restTimer.skip();
    else if (action === 'shorten') restTimer.shorten(seconds ?? 0);
    else restTimer.extend(seconds ?? 0);
  };
  const label = phase === 'over' ? 'Rest over' : phase === 'paused' ? 'rest paused' : 'rest';

  return (
    <div className={`workout-rest-bar ${phase}`} role="group" aria-label="Rest timer">
      <span className="rest-clock" role="timer" aria-live="off">
        <Timer size={15} aria-hidden="true" />
        <span className="rest-clock-value">{showClock(remaining)}</span>
        <span className="rest-clock-label"> {label}</span>
        <span className="rest-track" aria-hidden="true">
          <span style={{ transform: `scaleX(${restShareLeft(rest, now)})` }} />
        </span>
      </span>
      {nextUp && phase === 'running' && <p className="rest-next">Next: {nextUp}</p>}
      {phase === 'running' && (
        <div className="rest-bar-actions" role="group" aria-label="Adjust rest">
          <Button variant="tertiary" disabled={disabled} aria-label="Take 30 seconds off the rest" onClick={adjust('shorten', 30)}>−30</Button>
          <Button variant="tertiary" disabled={disabled} aria-label="Add 30 seconds of rest" onClick={adjust('extend', 30)}>+30</Button>
          <Button variant="tertiary" disabled={disabled} onClick={adjust('skip')}>Skip</Button>
        </div>
      )}
    </div>
  );
}
