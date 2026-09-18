import { Check, Timer } from 'lucide-react';
import type { Preferences } from '../types';
import { showClock } from '../lib/training';
import { restTimer } from '../lib/restTimer';
import { Button } from './ui/Button';

export function WorkoutFooter({
  remaining,
  totalSeconds,
  preferences,
  busy,
  onDiscard,
  onMinimize,
  onFinish
}: {
  remaining: number;
  totalSeconds: number;
  preferences: Preferences;
  busy: boolean;
  onDiscard: () => void;
  onMinimize: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="workout-footer">
      <div className={`rest-control ${remaining > 0 ? 'resting' : ''}`}>
        <Timer size={19} />
        <span className="rest-clock" role="timer" aria-live="off">
          {remaining > 0 ? `${showClock(remaining)} rest` : 'Rest timer'}
        </span>
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
          aria-label={
            remaining > 0
              ? 'Add 30 seconds of rest'
              : `Start a ${preferences.restSeconds} second rest`
          }
          onClick={() =>
            remaining > 0 ? restTimer.extend(30) : restTimer.start(preferences.restSeconds)
          }
        >
          +{remaining > 0 ? '30s' : `${preferences.restSeconds}s`}
        </Button>
        {remaining > 0 && (
          <Button variant="tertiary" onClick={() => restTimer.skip()}>
            Skip
          </Button>
        )}
      </div>

      <div className="modal-actions">
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
