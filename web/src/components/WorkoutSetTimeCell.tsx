import { useEffect, useState } from 'react';
import { Check, Pause, Play, RotateCcw } from 'lucide-react';
import type { LoggedSet } from '../types';
import { MAX_SET_SECONDS, showSetDuration, stopwatchSeconds } from '../lib/setDuration';
import { discardStopwatch, setStopwatchAnnouncer, startStopwatch, stopStopwatch, useStopwatch } from '../lib/setStopwatch';
import { restTimer } from '../lib/restTimer';
import { useVisibleClock } from '../lib/useVisibleClock';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

setStopwatchAnnouncer(() => restTimer.announceSetTimer());

/**
 * Seconds for a timed set, typed or timed via the modal sheet opened on click. With a target the
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
  const [modalOpen, setModalOpen] = useState(false);
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

  const adjustSeconds = (delta: number) => {
    discardStopwatch(set.id);
    const base = set.durationSeconds ?? targetSeconds ?? 0;
    const next = Math.max(1, Math.min(MAX_SET_SECONDS, base + delta));
    onChange(next);
  };

  const resetDuration = () => {
    discardStopwatch(set.id);
    onChange(null);
  };

  const formattedDuration = set.durationSeconds != null ? showSetDuration(set.durationSeconds) : '';
  const displayValue = clock !== null ? (countingDown ? `${clock} left` : clock) : formattedDuration;

  return (
    <div className={`set-input-cell time-cell ${running ? 'timing' : ''}`}>
      <input
        name={`duration-${set.id}`}
        aria-label={`${label} ${clock !== null ? (countingDown ? 'time left' : 'time so far') : 'duration'}`}
        type="text"
        readOnly
        inputMode="none"
        value={displayValue}
        placeholder={targetSeconds === null ? '—' : showSetDuration(targetSeconds)}
        aria-haspopup="dialog"
        aria-expanded={modalOpen}
        onClick={() => setModalOpen(true)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setModalOpen(true);
          }
        }}
      />

      {modalOpen && (
        <Modal title="Set duration" onClose={() => setModalOpen(false)}>
          <div className="modal-body timer-modal-body">
            <p className="muted" style={{ margin: 0 }}>{label}</p>
            <div className={`timer-modal-clock ${running ? 'timing' : ''}`}>
              <strong>{clock !== null ? clock : (set.durationSeconds != null ? showSetDuration(set.durationSeconds) : (targetSeconds != null ? showSetDuration(targetSeconds) : '0:00'))}</strong>
              <span className="muted">
                {running ? (countingDown ? 'Time remaining' : 'Timing elapsed') : (targetSeconds != null ? `Target: ${showSetDuration(targetSeconds)}` : 'Duration')}
              </span>
            </div>

            <Button
              variant={running ? 'primary' : 'secondary'}
              className="full-width timer-modal-toggle-btn"
              onClick={toggleStopwatch}
            >
              {running ? <Pause size={18} /> : <Play size={18} />}
              <span>{running ? 'Pause timer' : targetSeconds != null ? `Start ${showSetDuration(targetSeconds)} timer` : 'Start timer'}</span>
            </Button>

            <div className="timer-modal-direct-input">
              <span className="tiny-label">ADJUST TIME</span>
              <div className="timer-modal-input-row">
                <Button variant="tertiary" onClick={() => adjustSeconds(-15)}>−15s</Button>
                <Button variant="tertiary" onClick={() => adjustSeconds(-5)}>−5s</Button>
                <input
                  type="number"
                  min="1"
                  max={MAX_SET_SECONDS}
                  placeholder={targetSeconds != null ? String(targetSeconds) : 'sec'}
                  value={set.durationSeconds ?? ''}
                  onChange={event => {
                    discardStopwatch(set.id);
                    onChange(event.target.value === '' ? null : Math.round(Number(event.target.value)));
                  }}
                />
                <Button variant="tertiary" onClick={() => adjustSeconds(5)}>+5s</Button>
                <Button variant="tertiary" onClick={() => adjustSeconds(15)}>+15s</Button>
              </div>
            </div>

            <div className="timer-modal-actions" style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              {set.durationSeconds != null && !running && (
                <Button variant="tertiary" onClick={resetDuration}>
                  <RotateCcw size={16} /> Reset
                </Button>
              )}
              <Button variant="primary" className="full-width" onClick={() => setModalOpen(false)}>
                <Check size={18} /> Done
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
