import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, RotateCcw } from 'lucide-react';
import type { LoggedSet } from '../types';
import { MAX_SET_SECONDS, showSetDuration, stopwatchSeconds } from '../lib/setDuration';
import { discardStopwatch, setStopwatchAnnouncer, startStopwatch, stopStopwatch, useStopwatch } from '../lib/setStopwatch';
import { restTimer } from '../lib/restTimer';
import { useVisibleClock } from '../lib/useVisibleClock';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

setStopwatchAnnouncer(() => restTimer.announceSetTimer());

function formatClockDigits(digits: string): string {
  const clean = digits.replace(/^0+/, '');
  if (!clean) return '0:00';
  if (clean.length === 1) return `0:0${clean}`;
  if (clean.length === 2) return `0:${clean}`;
  const s = clean.slice(-2);
  const m = clean.slice(0, -2);
  return `${m}:${s}`;
}

function parseClockDigits(digits: string): number | null {
  const clean = digits.replace(/^0+/, '');
  if (!clean) return null;
  const s = Number(clean.slice(-2) || 0);
  const m = Number(clean.slice(0, -2) || 0);
  const total = m * 60 + s;
  return Math.min(MAX_SET_SECONDS, total);
}

function secondsToClockDigits(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return String(s);
  return `${m}${String(s).padStart(2, '0')}`;
}

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

  const [digits, setDigits] = useState<string>(() => secondsToClockDigits(set.durationSeconds));
  const clockInputRef = useRef<HTMLInputElement>(null);

  // A countdown that ended (perhaps while this row was off screen) is written into the set once.
  useEffect(() => {
    if (finished === undefined) return;
    const seconds = stopStopwatch(set.id);
    if (seconds !== null) onChange(seconds);
  }, [finished, set.id, onChange]);

  useEffect(() => {
    if (modalOpen && !running) {
      setDigits(secondsToClockDigits(set.durationSeconds));
    }
  }, [modalOpen, running, set.durationSeconds]);

  const reached = running ? stopwatchSeconds(running.baseSeconds, running.startedAtMs, now, running.targetSeconds) : null;
  const countingDown = running?.targetSeconds != null;
  const clock = running && reached !== null
    ? showSetDuration(countingDown ? running.targetSeconds! - reached : reached)
    : null;

  const toggleStopwatch = () => {
    if (!running) {
      restTimer.primeSound();
      startStopwatch(set.id, set.durationSeconds, targetSeconds);
      setModalOpen(false);
      return;
    }
    const seconds = stopStopwatch(set.id);
    if (seconds !== null) onChange(seconds > 0 ? seconds : null);
  };

  const pushDigit = (digit: string) => {
    discardStopwatch(set.id);
    setDigits(prev => {
      const next = `${prev}${digit}`.replace(/^0+/, '').slice(-4);
      const sec = parseClockDigits(next);
      onChange(sec);
      return next;
    });
  };

  const popDigit = () => {
    discardStopwatch(set.id);
    setDigits(prev => {
      const next = prev.slice(0, -1);
      const sec = parseClockDigits(next);
      onChange(sec);
      return next;
    });
  };

  const clearDigits = () => {
    discardStopwatch(set.id);
    setDigits('');
    onChange(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      pushDigit(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      popDigit();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      clearDigits();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    const clean = raw.replace(/^0+/, '').slice(-4);
    discardStopwatch(set.id);
    setDigits(clean);
    onChange(parseClockDigits(clean));
  };

  const resetDuration = () => {
    clearDigits();
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
            <div
              className={`timer-modal-clock ${running ? 'timing' : 'editable'}`}
              onClick={() => { if (!running) clockInputRef.current?.focus(); }}
            >
              {running ? (
                <strong className="timer-modal-clock-display">{clock}</strong>
              ) : (
                <input
                  ref={clockInputRef}
                  id={`duration-edit-${set.id}`}
                  name={`duration-edit-${set.id}`}
                  type="text"
                  inputMode="numeric"
                  className="timer-modal-clock-input"
                  value={formatClockDigits(digits)}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  aria-label={`${label} duration`}
                  autoComplete="off"
                />
              )}
              <span className="muted">
                {running
                  ? (countingDown ? 'Time remaining' : 'Timing elapsed')
                  : (targetSeconds != null && digits === '' ? `Target: ${showSetDuration(targetSeconds)}` : 'Duration')}
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

            <div className="timer-modal-actions" style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              {(set.durationSeconds != null || digits !== '') && !running && (
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
