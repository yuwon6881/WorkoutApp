import { useEffect } from 'react';
import { Pause, Play } from 'lucide-react';
import type { LoggedSet } from '../types';
import { MAX_SET_SECONDS, showSetDuration, stopwatchSeconds } from '../lib/setDuration';
import { discardStopwatch, setStopwatchAnnouncer, startStopwatch, stopStopwatch, useStopwatch } from '../lib/setStopwatch';
import { restTimer } from '../lib/restTimer';
import { useVisibleClock } from '../lib/useVisibleClock';
import { Button } from './ui/Button';

setStopwatchAnnouncer(() => restTimer.announceSetTimer());

/**
 * Seconds for a timed set, typed directly or timed with the button beside it. With a target the
 * timer counts down and finishes itself with a chime; without one it counts up until stopped.
 * Stopping writes the time into the set; logging the set while it runs records it as well.
 */
export function WorkoutSetTimeCell({
  set,
  label,
  targetSeconds,
  onChange
}: {
  set: LoggedSet;
  /** "Plank set 2", used in the accessible names. */
  label: string;
  targetSeconds: number | null;
  onChange: (durationSeconds: number | null) => void;
}) {
  const running = useStopwatch(set.id);
  const now = useVisibleClock(running !== undefined && running.finishedSeconds === undefined);
  const finished = running?.finishedSeconds;

  // A countdown that ended (perhaps while this row was off screen) is written into the set once.
  useEffect(() => {
    if (finished === undefined) return;
    const seconds = stopStopwatch(set.id);
    if (seconds !== null) onChange(seconds);
  }, [finished, set.id, onChange]);

  const reached = running ? stopwatchSeconds(running.baseSeconds, running.startedAtMs, now, running.targetSeconds) : null;
  const countingDown = running?.targetSeconds != null;
  const clock = running && reached !== null
    ? showSetDuration(countingDown ? running.targetSeconds! - reached : reached)
    : null;

  const toggleStopwatch = () => {
    if (!running) {
      restTimer.primeSound();
      startStopwatch(set.id, set.durationSeconds, targetSeconds);
      return;
    }
    const seconds = stopStopwatch(set.id);
    if (seconds !== null) onChange(seconds > 0 ? seconds : null);
  };

  return (
    <div className={`set-input-cell time-cell ${running ? 'timing' : ''}`}>
      {clock !== null ? (
        <input
          name={`duration-${set.id}`}
          aria-label={`${label} ${countingDown ? 'time left' : 'time so far'}`}
          type="text"
          value={countingDown ? `${clock} left` : clock}
          readOnly
        />
      ) : (
        <input
          name={`duration-${set.id}`}
          aria-label={`${label} time in seconds`}
          inputMode="numeric"
          type="number"
          min="1"
          max={MAX_SET_SECONDS}
          placeholder={targetSeconds === null ? 'sec' : String(targetSeconds)}
          value={set.durationSeconds ?? ''}
          onChange={event => {
            discardStopwatch(set.id);
            onChange(event.target.value === '' ? null : Math.round(Number(event.target.value)));
          }}
        />
      )}
      <Button
        variant={running ? 'primary' : 'secondary'}
        className="set-stopwatch-btn"
        aria-label={running ? `Stop timing ${label}` : `Start ${targetSeconds === null ? 'timing' : `a ${targetSeconds} second countdown for`} ${label}`}
        aria-pressed={running !== undefined}
        onClick={toggleStopwatch}
      >
        {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      </Button>
    </div>
  );
}
