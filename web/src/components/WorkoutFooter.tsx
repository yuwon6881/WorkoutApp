import { Check, Timer } from 'lucide-react';
import { showClock } from '../lib/training';
import { restTimer } from '../lib/restTimer';
import { Button } from './ui/Button';

export function WorkoutFooter({
  error,
  remaining,
  totalSeconds,
  restEndedAt,
  defaultRestSeconds,
  busy,
  restDisabled = false,
  onDiscard,
  onMinimize,
  onFinish
}: {
  error: string;
  remaining: number;
  totalSeconds: number;
  restEndedAt: number | null;
  defaultRestSeconds?: number | null;
  busy: boolean;
  restDisabled?: boolean;
  onDiscard: () => void;
  onMinimize: () => void;
  onFinish: () => void;
}) {
  const defaultRest = defaultRestSeconds && defaultRestSeconds > 0 ? defaultRestSeconds : 90;
  return (
    <div className="workout-footer">
      <div className={`rest-control ${remaining > 0 ? 'resting' : ''}`}>
        <Timer size={19} />
        <span className="rest-clock" role="timer" aria-live="off">
          {remaining > 0 ? `${showClock(remaining)} rest` : 'Rest timer'}
        </span>
        {remaining === 0 && restEndedAt !== null && <span className="device-status" role="status">Rest ended at {new Date(restEndedAt).toLocaleTimeString()}</span>}
        {remaining > 0 && (
          <span className="rest-track" aria-hidden="true">
            <span
              style={{
                width: `${
                  totalSeconds > 0 ? Math.min(100, (remaining / totalSeconds) * 100) : 0
                }%`
              }}
            />
          </span>
        )}
        <Button
          variant="tertiary"
          disabled={busy || restDisabled}
          aria-label={
            remaining > 0
              ? 'Add 30 seconds of rest'
              : `Start a ${defaultRest} second rest`
          }
          onClick={() =>
            remaining > 0 ? restTimer.extend(30) : restTimer.start(defaultRest)
          }
        >
          +{remaining > 0 ? '30s' : `${defaultRest}s`}
        </Button>
        {remaining > 0 && (
          <Button variant="tertiary" disabled={busy || restDisabled} onClick={() => restTimer.skip()}>
            Skip
          </Button>
        )}
      </div>

      <div className="modal-actions">
        {error && <p className="error-text modal-actions-error" role="alert">{error}</p>}
        <Button variant="destructive" disabled={busy} onClick={onDiscard}>
          Discard
        </Button>
        <Button onClick={onMinimize}>Minimize</Button>
        <Button variant="primary" disabled={busy} onClick={onFinish}>
          Finish workout
          <Check size={17} />
        </Button>
      </div>
    </div>
  );
}
