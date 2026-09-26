import { Check, ChevronDown, Clock3, Cloud, CloudOff, LayoutGrid, Maximize2, Pause, Play, Trash2 } from 'lucide-react';
import { showDuration } from '../lib/training';
import { shortSyncStatus } from '../lib/workoutSyncStatus';
import { Button } from './ui/Button';
import { MenuButton, MenuItem } from './ui/MenuButton';

/// The workout's only header. It is also the sheet's drag handle on phones, so pulling it down
/// minimizes the workout like the chevron does. The save status is a short word here, with the
/// full sentence read to assistive technology, so it never takes a line of its own.
export function WorkoutTopBar({
  name,
  elapsed,
  done,
  planned,
  viewMode,
  paused,
  pauseDisabled,
  syncMessage,
  online,
  discardDisabled,
  onClose,
  onTogglePause,
  onToggleViewMode,
  onDiscard
}: {
  name: string;
  elapsed: number;
  done: number;
  planned: number;
  viewMode: 'focus' | 'all';
  paused: boolean;
  pauseDisabled: boolean;
  syncMessage: string;
  online: boolean;
  discardDisabled: boolean;
  onClose: () => void;
  onTogglePause: () => void;
  onToggleViewMode: () => void;
  onDiscard: () => void;
}) {
  const sync = shortSyncStatus(syncMessage, online);
  return (
    <div className={`workout-top-status-bar ${paused ? 'paused' : ''}`} data-sheet-handle="">
      <Button variant="tertiary" className="workout-top-icon" aria-label="Minimize workout" title="Minimize" onClick={onClose}>
        <ChevronDown size={20} />
      </Button>

      <div className="workout-top-summary">
        <h2 className="workout-top-title">{name}</h2>
        <div className="workout-top-meta">
          <span className="workout-elapsed-clock" role="timer" aria-label={`Active time ${showDuration(elapsed)}`}>
            <Clock3 size={14} aria-hidden="true" />
            {showDuration(elapsed)}
          </span>
          {paused ? (
            <span className="workout-paused-label" role="status">Paused</span>
          ) : (
            <span className="workout-sets-badge">
              <Check size={13} aria-hidden="true" />
              {done}/{planned}
              <span className="sr-only"> sets</span>
            </span>
          )}
          {sync && (
            <span className={`workout-sync-status ${sync.tone}`} aria-hidden="true">
              {sync.tone === 'offline' ? <CloudOff size={13} /> : <Cloud size={13} />}
              {sync.label}
            </span>
          )}
        </div>
        <p className="sr-only workout-sync-announcement" role="status">{syncMessage}</p>
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
        <MenuButton label="Workout options" triggerClassName="workout-top-icon" portal>
          <MenuItem onClick={onToggleViewMode}>
            {viewMode === 'focus' ? <LayoutGrid size={16} /> : <Maximize2 size={16} />}
            {viewMode === 'focus' ? 'View all exercises' : 'Focus on active exercise'}
          </MenuItem>
          <MenuItem destructive disabled={discardDisabled} onClick={onDiscard}>
            <Trash2 size={16} />
            Discard workout
          </MenuItem>
        </MenuButton>
      </div>
    </div>
  );
}
