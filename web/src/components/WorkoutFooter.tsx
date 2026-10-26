import type { RestState } from '../lib/restTimer';
import type { RestAction } from '../types';
import { Button } from './ui/Button';
import { WorkoutRestDock } from './WorkoutRestDock';

/// The bottom of the sheet. Sets are logged with their own tick, so the footer only appears when it
/// has something to say: an error or, once every working set is logged, the way to finish. Above it,
/// a phone shows the running rest's adjustments in the thumb zone (WorkoutRestDock.tsx). Finishing
/// early lives in the workout's options menu; a personal best floats under the header.
export function WorkoutFooter({
  error,
  busy,
  canFinish,
  onFinish,
  rest,
  paused,
  onRestMutate
}: {
  error: string;
  busy: boolean;
  canFinish: boolean;
  onFinish: () => void;
  rest: RestState;
  paused: boolean;
  onRestMutate: (action: RestAction, seconds?: number) => void;
}) {
  // A paused workout holds its rest, so the adjustments wait for it to resume, as in the header.
  const dock = <WorkoutRestDock rest={rest} disabled={busy || paused} onRestMutate={onRestMutate} />;
  if (!error && !canFinish) return dock;
  return (
    <>
      {dock}
      <div className="workout-footer">
        <div className="workout-footer-actions">
          {error && <p className="error-text modal-actions-error" role="alert">{error}</p>}
          {canFinish && (
            <Button variant="primary" className="workout-finish-btn" aria-label="Finish workout" disabled={busy} onClick={onFinish}>
              Finish workout
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
