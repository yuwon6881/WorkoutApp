import { showClock } from '../lib/training';
import { remainingRestSeconds, type RestState } from '../lib/restTimer';
import { restPhase, restShareLeft } from '../lib/restDisplay';
import { useVisibleClock } from '../lib/useVisibleClock';
import type { RestAction } from '../types';
import { RestAdjustButtons } from './WorkoutRestBar';

/// On a phone the rest's adjustments sit in the thumb zone, above the sheet's bottom edge, as large
/// separated buttons; the header keeps only the countdown. The dock takes the bottom of the scroll
/// area while a rest runs rather than covering it, so starting or ending a rest moves no set row.
/// Wider layouts keep the adjustments in the header, where they have room (WorkoutRestBar.tsx).
export function WorkoutRestDock({ rest, disabled, onRestMutate }: {
  rest: RestState;
  disabled: boolean;
  onRestMutate?: (action: RestAction, seconds?: number) => void;
}) {
  const now = useVisibleClock(rest.endsAt > 0);
  if (restPhase(rest, now) !== 'running') return null;
  return (
    <div className="workout-rest-dock" role="group" aria-label="Rest">
      <span className="rest-dock-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${restShareLeft(rest, now)})` }} />
      </span>
      {/* The header's countdown is the announced timer; this one only puts it beside the buttons. */}
      <span className="rest-dock-clock" aria-hidden="true">
        <span className="rest-dock-label">Rest</span>
        <span className="rest-dock-value">{showClock(remainingRestSeconds(rest, now))}</span>
      </span>
      <RestAdjustButtons className="rest-dock-actions" variant="secondary" disabled={disabled} onRestMutate={onRestMutate} />
    </div>
  );
}
