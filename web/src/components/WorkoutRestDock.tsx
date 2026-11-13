import type { RestState } from '../lib/restTimer';
import { restPhase, restShareLeft } from '../lib/restDisplay';
import { useVisibleClock } from '../lib/useVisibleClock';
import type { RestAction } from '../types';
import { RestAdjustButtons } from './WorkoutRestBar';

/// On a phone the rest's adjustments sit in the thumb zone, above the sheet's bottom edge, as large
/// separated buttons. The header already shows the countdown, so the dock names the set the rest
/// leads into instead of repeating the clock; its top edge drains with the rest. The dock takes the
/// bottom of the scroll area while a rest runs rather than covering it, so starting or ending a rest
/// moves no set row. Wider layouts keep the adjustments in the header (WorkoutRestBar.tsx).
export function WorkoutRestDock({ rest, nextUp = null, disabled, onRestMutate }: {
  rest: RestState;
  nextUp?: string | null;
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
      <p className="rest-dock-next">
        <span className="rest-dock-label">{nextUp ? 'Next' : 'Resting'}</span>
        {nextUp && <span className="rest-dock-next-text">{nextUp}</span>}
      </p>
      <RestAdjustButtons className="rest-dock-actions" variant="secondary" disabled={disabled} onRestMutate={onRestMutate} />
    </div>
  );
}
