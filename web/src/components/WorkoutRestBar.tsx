import { showClock } from '../lib/training';
import { remainingRestSeconds, restTimer, type RestState } from '../lib/restTimer';
import { useVisibleClock } from '../lib/useVisibleClock';
import type { RestAction } from '../types';
import { Button } from './ui/Button';

/// The rest countdown, pinned under the workout's header while a rest runs: a compact clock, quick
/// adjustments, and what comes next. It is absent between rests; the next logged set starts it.
export function WorkoutRestBar({ rest, disabled, nextUp, onRestMutate }: {
  rest: RestState;
  disabled: boolean;
  nextUp: string | null;
  onRestMutate?: (action: RestAction, seconds?: number) => void;
}) {
  const now = useVisibleClock(rest.endsAt > Date.now());
  const remaining = remainingRestSeconds(rest, now);
  if (remaining <= 0) return null;
  const share = rest.totalSeconds > 0 ? Math.min(100, (remaining / rest.totalSeconds) * 100) : 0;
  const adjust = (action: RestAction, seconds?: number) => () => {
    if (onRestMutate) onRestMutate(action, seconds);
    else if (action === 'skip') restTimer.skip();
    else if (action === 'shorten') restTimer.shorten(seconds ?? 0);
    else restTimer.extend(seconds ?? 0);
  };

  return (
    <div className="workout-rest-bar">
      <div className="rest-bar-head">
        <span className="rest-clock" role="timer" aria-live="off">
          <span className="rest-clock-value">{showClock(remaining)}</span> rest
        </span>
        <div className="rest-bar-actions" role="group" aria-label="Adjust rest">
          <Button variant="tertiary" disabled={disabled} aria-label="Take 30 seconds off the rest" onClick={adjust('shorten', 30)}>−30</Button>
          <Button variant="tertiary" disabled={disabled} aria-label="Add 30 seconds of rest" onClick={adjust('extend', 30)}>+30</Button>
          <Button variant="tertiary" disabled={disabled} onClick={adjust('skip')}>Skip</Button>
        </div>
      </div>
      <span className="rest-track" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
      {nextUp && <p className="rest-next">Next: {nextUp}</p>}
    </div>
  );
}
