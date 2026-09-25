import { Check, ChevronDown, Clock3, LayoutGrid, Maximize2, Pause, Play } from 'lucide-react';
import { showDuration } from '../lib/training';
import { Button } from './ui/Button';

/// The session's always-visible controls. Everything here fits one line at 320 px: the rest
/// countdown lives in the footer, beside the actions that start and skip it.
export function WorkoutTopBar({
  elapsed,
  done,
  planned,
  viewMode,
  paused,
  pauseDisabled,
  onClose,
  onTogglePause,
  onToggleViewMode
}: {
  elapsed: number;
  done: number;
  planned: number;
  viewMode: 'focus' | 'all';
  paused: boolean;
  pauseDisabled: boolean;
  onClose: () => void;
  onTogglePause: () => void;
  onToggleViewMode: () => void;
}) {
  return (
    <div className={`workout-top-status-bar ${paused ? 'paused' : ''}`}>
      <Button
        variant="tertiary"
        className="workout-top-icon"
        aria-label="Minimize workout"
        title="Minimize"
        onClick={onClose}
      >
        <ChevronDown size={20} />
      </Button>

      <div className="workout-top-summary">
        <span className="workout-elapsed-clock" role="timer" aria-label={`Active time ${showDuration(elapsed)}`} title="Active workout time">
          <Clock3 size={15} aria-hidden="true" />
          {showDuration(elapsed)}
        </span>
        {paused ? (
          <span className="workout-paused-label" role="status">Paused</span>
        ) : (
          <span className="workout-sets-badge">
            <Check size={14} aria-hidden="true" />
            {done} / {planned} sets
          </span>
        )}
      </div>

      <div className="workout-top-actions">
        <Button
          variant={paused ? 'primary' : 'tertiary'}
          className="workout-top-icon"
          disabled={pauseDisabled}
          aria-label={paused ? 'Resume workout' : 'Pause workout'}
          title={paused ? 'Resume' : 'Pause'}
          onClick={onTogglePause}
        >
          {paused ? <Play size={18} /> : <Pause size={18} />}
        </Button>
        <Button
          variant="tertiary"
          className="workout-top-icon"
          aria-label={viewMode === 'focus' ? 'View all exercises' : 'Focus on active exercise'}
          title={viewMode === 'focus' ? 'All exercises' : 'One exercise'}
          onClick={onToggleViewMode}
        >
          {viewMode === 'focus' ? <LayoutGrid size={18} /> : <Maximize2 size={18} />}
        </Button>
      </div>
    </div>
  );
}
