import { Check, Timer, Trophy } from 'lucide-react';
import { showClock } from '../lib/training';
import { restTimer } from '../lib/restTimer';
import { Button } from './ui/Button';

export type LogAction = { label: string; detail: string; ariaLabel: string; onLog: () => void };

/// The thumb zone. While resting it is the rest bar: a large countdown, quick adjustments, and
/// what comes next. Below it sits the one primary action, logging the next set, in the same place
/// for every set, and Finish once there is something to save.
export function WorkoutFooter({
  error,
  remaining,
  totalSeconds,
  restEndedAt,
  defaultRestSeconds,
  busy,
  restDisabled = false,
  nextUp,
  logAction,
  celebration = '',
  onFinish
}: {
  error: string;
  remaining: number;
  totalSeconds: number;
  restEndedAt: number | null;
  defaultRestSeconds?: number | null;
  busy: boolean;
  restDisabled?: boolean;
  nextUp: string | null;
  logAction: LogAction | null;
  celebration?: string;
  onFinish: () => void;
}) {
  const defaultRest = defaultRestSeconds && defaultRestSeconds > 0 ? defaultRestSeconds : 90;
  const resting = remaining > 0;
  const restAdjustDisabled = busy || restDisabled;

  return (
    <div className="workout-footer">
      {celebration && <p className="workout-celebration" role="status"><Trophy size={17} aria-hidden="true" />{celebration}</p>}
      {resting ? (
        <div className="rest-bar resting">
          <div className="rest-bar-head">
            <span className="rest-clock" role="timer" aria-live="off">
              <span className="rest-clock-value">{showClock(remaining)}</span> rest
            </span>
            <span className="rest-track" aria-hidden="true">
              <span style={{ width: `${totalSeconds > 0 ? Math.min(100, (remaining / totalSeconds) * 100) : 0}%` }} />
            </span>
          </div>
          <div className="rest-bar-actions" role="group" aria-label="Adjust rest">
            <Button variant="tertiary" disabled={restAdjustDisabled} aria-label="Take 15 seconds off the rest" onClick={() => restTimer.shorten(15)}>−15s</Button>
            <Button variant="tertiary" disabled={restAdjustDisabled} aria-label="Add 15 seconds of rest" onClick={() => restTimer.extend(15)}>+15s</Button>
            <Button variant="tertiary" disabled={restAdjustDisabled} aria-label="Add 30 seconds of rest" onClick={() => restTimer.extend(30)}>+30s</Button>
            <Button variant="secondary" disabled={restAdjustDisabled} onClick={() => restTimer.skip()}>Skip</Button>
          </div>
          {nextUp && <p className="rest-next">Next: {nextUp}</p>}
        </div>
      ) : (
        <div className="rest-bar">
          <Timer size={18} aria-hidden="true" />
          <span className="rest-clock" role="timer" aria-live="off">
            {restEndedAt !== null ? `Rest ended ${new Date(restEndedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Rest timer'}
          </span>
          <Button variant="tertiary" disabled={restAdjustDisabled} aria-label={`Start a ${defaultRest} second rest`} onClick={() => restTimer.start(defaultRest)}>
            +{defaultRest}s
          </Button>
        </div>
      )}

      <div className={`workout-footer-actions ${logAction ? 'has-log' : ''}`.trim()}>
        {error && <p className="error-text modal-actions-error" role="alert">{error}</p>}
        <Button variant={logAction ? 'secondary' : 'primary'} className="workout-finish-btn" aria-label="Finish workout" disabled={busy} onClick={onFinish}>
          {logAction ? 'Finish' : 'Finish workout'}
          <Check size={17} />
        </Button>
        {logAction && (
          <Button variant="primary" className="workout-log-next" disabled={busy} aria-label={`Next set: ${logAction.ariaLabel}`} onClick={logAction.onLog}>
            <span className="log-next-label">{logAction.label}</span>
            {logAction.detail && <span className="log-next-detail">{logAction.detail}</span>}
          </Button>
        )}
      </div>
    </div>
  );
}
