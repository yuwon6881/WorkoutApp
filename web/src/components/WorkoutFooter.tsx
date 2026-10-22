import { Button } from './ui/Button';

/// Sets are logged with their own tick, so the footer only appears when it has something to say:
/// an error or, once every working set is logged, the way to finish. Finishing early lives in the
/// workout's options menu; a personal best floats under the header (WorkoutCelebration.tsx).
export function WorkoutFooter({
  error,
  busy,
  canFinish,
  onFinish
}: {
  error: string;
  busy: boolean;
  canFinish: boolean;
  onFinish: () => void;
}) {
  if (!error && !canFinish) return null;
  return (
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
  );
}
