import { ChevronDown, Flag, Info, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { Session } from '../types';
import { WorkoutElapsed } from './WorkoutElapsed';
import { shortSyncStatus } from '../lib/workoutSyncStatus';
import { Button } from './ui/Button';
import { MenuButton, MenuItem } from './ui/MenuButton';

/// The workout's only header. It is also the sheet's drag handle on phones, so pulling it down
/// minimizes the workout like the chevron at its trailing edge does. Logged working sets fill the
/// line along its bottom edge. Routine saving stays quiet: only a save problem (offline, not saved,
/// needs review) shows a word, and the full sentence is always read to assistive technology.
export function WorkoutTopBar({
  name,
  session,
  finishedAt,
  done,
  planned,
  paused,
  pauseDisabled,
  syncMessage,
  online,
  discardDisabled,
  finishDisabled,
  hasDetails,
  canRestore,
  restoreDisabled,
  onClose,
  onTogglePause,
  onFinish,
  onDetails,
  onRestore,
  onDiscard
}: {
  name: string;
  session: Pick<Session, 'startedAt' | 'pausedAt' | 'pausedSeconds'>;
  finishedAt: string | null;
  done: number;
  planned: number;
  paused: boolean;
  pauseDisabled: boolean;
  syncMessage: string;
  online: boolean;
  discardDisabled: boolean;
  finishDisabled: boolean;
  hasDetails: boolean;
  /** Offered only for a workout started from a program day or saved workout. */
  canRestore: boolean;
  restoreDisabled: boolean;
  onClose: () => void;
  onTogglePause: () => void;
  onFinish: () => void;
  onDetails: () => void;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const sync = shortSyncStatus(syncMessage, online);
  const problem = sync && (sync.tone === 'offline' || sync.tone === 'warning') ? sync : null;
  const fraction = planned > 0 ? Math.min(1, done / planned) : 0;
  return (
    <div className={`workout-top-status-bar ${paused ? 'paused' : ''}`} data-sheet-handle="">
      <div className="workout-top-summary">
        <h2 className="workout-top-title">{name}</h2>
        <div className="workout-top-meta">
          <WorkoutElapsed session={session} finishedAt={finishedAt} />
          {paused && <span className="workout-paused-label" role="status">Paused</span>}
          {problem && <span className={`workout-sync-status ${problem.tone}`} aria-hidden="true">{problem.label}</span>}
        </div>
        <p className="sr-only workout-sync-announcement" role="status">{syncMessage}</p>
      </div>

      <div
        className="workout-sets-progress"
        role="progressbar"
        aria-label="Working sets logged"
        aria-valuemin={0}
        aria-valuemax={planned}
        aria-valuenow={Math.min(done, planned)}
        aria-valuetext={`${done} of ${planned} working sets logged`}
      >
        <span style={{ transform: `scaleX(${fraction})` }} />
      </div>

      <div className="workout-top-actions">
        <Button
          variant={paused ? 'primary' : 'tertiary'}
          className="workout-top-icon"
          disabled={pauseDisabled}
          aria-label={paused ? 'Resume workout' : 'Pause workout'}
          onClick={onTogglePause}
        >
          {paused ? <Play size={18} /> : <Pause size={18} />}
        </Button>
        <MenuButton disabled={paused} label="Workout options" triggerClassName="workout-top-icon" portal>
          {hasDetails && <MenuItem onClick={onDetails}>
            <Info size={16} />
            Workout details
          </MenuItem>}
          {canRestore && <MenuItem disabled={restoreDisabled} onClick={onRestore}>
            <RotateCcw size={16} />
            Restore program defaults
          </MenuItem>}
          <MenuItem disabled={finishDisabled} onClick={onFinish}>
            <Flag size={16} />
            Finish workout
          </MenuItem>
          <MenuItem destructive disabled={discardDisabled} onClick={onDiscard}>
            <Trash2 size={16} />
            Discard workout
          </MenuItem>
        </MenuButton>
        <Button variant="tertiary" className="workout-top-icon" aria-label="Minimize workout" title="Minimize" onClick={onClose}>
          <ChevronDown size={20} />
        </Button>
      </div>
    </div>
  );
}
