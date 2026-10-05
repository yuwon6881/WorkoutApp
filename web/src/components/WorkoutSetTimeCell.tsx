import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, RotateCcw } from 'lucide-react';
import type { LoggedSet } from '../types';
import { showSetDuration, stopwatchSeconds } from '../lib/setDuration';
import {
  formatClockDigits, normalizeClockDigits, parseClockDigits, popClockDigit, pushClockDigits, secondsToClockDigits
} from '../lib/clockDigits';
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
  const now = useVisibleClock(running !== undefined && running.finishedSeconds === undefined && running.pausedAtMs === undefined);
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

  const reached = running ? stopwatchSeconds(running.baseSeconds, running.startedAtMs, running.pausedAtMs ?? now, running.targetSeconds) : null;
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

  const applyDigits = (next: string) => {
    discardStopwatch(set.id);
    setDigits(next);
    onChange(parseClockDigits(next));
  };

  const clearDigits = () => applyDigits('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      applyDigits(pushClockDigits(digits, e.key));
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      applyDigits(popClockDigit(digits));
    } else if (e.key === 'Delete') {
      e.preventDefault();
      clearDigits();
    }
  };

  // Phone keyboards often report every key as "Unidentified" and only edit the text, so the edit
  // is taken from the native beforeinput event instead and the field's own text is never changed.
  // React's onBeforeInput does not carry the input type, hence the native listener.
  useEffect(() => {
    const input = clockInputRef.current;
    if (!input) return;
    const handleBeforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertText') {
        event.preventDefault();
        applyDigits(pushClockDigits(digits, event.data ?? ''));
      } else if (event.inputType === 'deleteContentBackward') {
        event.preventDefault();
        applyDigits(popClockDigit(digits));
      } else if (event.inputType.startsWith('delete')) {
        event.preventDefault();
        clearDigits();
      }
    };
    input.addEventListener('beforeinput', handleBeforeInput);
    return () => input.removeEventListener('beforeinput', handleBeforeInput);
  });

  // Paste, autofill, and any edit beforeinput did not cover arrive here as the whole field text.
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => applyDigits(pushClockDigits('', e.target.value));

  // Digits are added at the end, so the caret stays there wherever the field is tapped.
  const keepCaretAtEnd = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
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
                  onSelect={keepCaretAtEnd}
                  // Typed "90" saves ninety seconds; once the field is left it reads as 1:30.
                  onBlur={() => setDigits(normalizeClockDigits(digits))}
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
