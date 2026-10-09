import { ChevronDown, Flag, Info, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { RestAction, Session } from '../types';
import type { RestState } from '../lib/restTimer';
import { WorkoutElapsed } from './WorkoutElapsed';
import { WorkoutRestBar } from './WorkoutRestBar';
import { shortSyncStatus } from '../lib/workoutSyncStatus';
import { Button } from './ui/Button';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { useModalDismiss } from './ui/Modal';

/// The workout's only header, in two rows: the name with its three actions, then a status row with
/// the clock and logged sets leading and the rest timer trailing. The status row keeps one height
/// with or without a rest, so a rest never pushes the sets down. On phones the header is also the
/// sheet's drag handle, so pulling it down minimizes the workout like the chevron does. Logged
/// working sets fill the line along its bottom edge. Routine saving stays quiet: only a save problem
/// (offline, not saved, needs review) shows a word, and the full sentence is read to assistive tech.
export function WorkoutTopBar({
  name,
  session,
  finishedAt,
  done,
  planned,
  paused,
  pauseHint,
  pauseDisabled,
  syncMessage,
  online,
  discardDisabled,
  finishDisabled,
  hasDetails,
  canRestore,
  restoreDisabled,
  rest,
  nextUp,
  restDisabled,
  onRestMutate,
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
  /** Taps on a set's log button while paused; each change replays the paused pill's pulse. */
  pauseHint: number;
  pauseDisabled: boolean;
  syncMessage: string;
  online: boolean;
  discardDisabled: boolean;
  finishDisabled: boolean;
  hasDetails: boolean;
  /** Offered only for a workout started from a program day or saved workout. */
  canRestore: boolean;
  restoreDisabled: boolean;
  rest: RestState;
  /** The set the rest leads into, shown beside the countdown where there is room. */
  nextUp: string | null;
  restDisabled: boolean;
  onRestMutate: (action: RestAction, seconds?: number) => void;
  onClose: () => void;
  onTogglePause: () => void;
  onFinish: () => void;
  onDetails: () => void;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  // Minimizing goes through the sheet, so it slides away like a drag down does.
  const minimize = useModalDismiss() ?? onClose;
  const sync = shortSyncStatus(syncMessage, online);
  const problem = sync && (sync.tone === 'offline' || sync.tone === 'warning') ? sync : null;
  const fraction = planned > 0 ? Math.min(1, done / planned) : 0;
  return (
    <div className={`workout-top-status-bar ${paused ? 'paused' : ''}`} data-sheet-handle="">
      <div className="workout-top-row">
        <h2 className="workout-top-title">{name}</h2>
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
          <MenuButton label="Workout options" triggerClassName="workout-top-icon" portal>
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
          <Button variant="tertiary" className="workout-top-icon" aria-label="Minimize workout" title="Minimize" onClick={minimize}>
            <ChevronDown size={20} />
          </Button>
        </div>
      </div>

      <div className="workout-top-rail">
        <div className="workout-top-meta">
          <WorkoutElapsed session={session} finishedAt={finishedAt} />
          {paused && (
            <span key={pauseHint} className={`workout-paused-label ${pauseHint > 0 ? 'pulse' : ''}`} role="status">
              <Pause size={12} aria-hidden="true" />
              Paused
            </span>
          )}
          {planned > 0 && <span className="workout-top-sets">{Math.min(done, planned)}/{planned} sets</span>}
          {problem && <span className={`workout-sync-status ${problem.tone}`} aria-hidden="true">{problem.label}</span>}
        </div>
        <WorkoutRestBar rest={rest} nextUp={nextUp} disabled={restDisabled} onRestMutate={onRestMutate} />
      </div>
      <p className="sr-only workout-sync-announcement" role="status">{syncMessage}</p>

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
    </div>
  );
}
