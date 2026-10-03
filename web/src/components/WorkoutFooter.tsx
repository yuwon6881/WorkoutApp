import { Check, Trophy } from 'lucide-react';
import { Button } from './ui/Button';

/// Sets are logged with their own tick, so the footer only appears when it has something to say:
/// a personal best, an error, or, once every working set is logged, the way to finish. Finishing
/// early lives in the workout's options menu.
export function WorkoutFooter({
  error,
  busy,
  celebration = '',
  canFinish,
  onFinish
}: {
  error: string;
  busy: boolean;
  celebration?: string;
  canFinish: boolean;
  onFinish: () => void;
}) {
  if (!error && !celebration && !canFinish) return null;
  return (
    <div className="workout-footer">
      {celebration && <p className="workout-celebration" role="status"><Trophy size={17} aria-hidden="true" /><span className="celebration-text">{celebration}</span></p>}
      <div className="workout-footer-actions">
        {error && <p className="error-text modal-actions-error" role="alert">{error}</p>}
        {canFinish && (
          <Button variant="primary" className="workout-finish-btn" aria-label="Finish workout" disabled={busy} onClick={onFinish}>
            Finish workout
            <Check size={17} />
          </Button>
        )}
      </div>
    </div>
  );
}
