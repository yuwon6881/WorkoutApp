import { Check, Clock3, LayoutGrid, Maximize2, Menu, Timer } from 'lucide-react';
import { showClock } from '../lib/training';
import { Button } from './ui/Button';

export function WorkoutTopBar({
  elapsed,
  done,
  planned,
  viewMode,
  remaining,
  totalSeconds,
  onClose,
  onToggleViewMode
}: {
  elapsed: number;
  done: number;
  planned: number;
  viewMode: 'focus' | 'all';
  remaining: number;
  totalSeconds: number;
  onClose: () => void;
  onToggleViewMode: () => void;
}) {
  return (
    <div className="workout-top-status-bar">
      <div className="status-bar-left">
        <Button
          variant="tertiary"
          className="workout-nav-menu-btn"
          aria-label="Minimize workout"
          onClick={onClose}
        >
          <Menu size={18} />
        </Button>
        <span className="workout-elapsed-clock" title="Workout duration">
          <Clock3 size={15} />
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
        </span>
      </div>

      <div className="status-bar-center">
        <span className="workout-sets-badge">
          <Check size={14} />
          {done} / {planned} sets
        </span>
      </div>

      <div className="status-bar-right">
        <Button
          variant="tertiary"
          className="workout-view-toggle"
          aria-label={viewMode === 'focus' ? 'View all exercises' : 'Focus on active exercise'}
          onClick={onToggleViewMode}
        >
          {viewMode === 'focus' ? <LayoutGrid size={16} /> : <Maximize2 size={16} />}
          <span>{viewMode === 'focus' ? 'All' : 'Focus'}</span>
        </Button>

        {remaining > 0 && (
          <div className="header-rest-indicator resting" title="Rest timer counting down">
            <Timer size={14} />
            <span>{showClock(remaining)}</span>
            <span className="header-rest-track" aria-hidden="true">
              <span
                style={{
                  width: `${
                    totalSeconds > 0 ? Math.min(100, (remaining / totalSeconds) * 100) : 0
                  }%`
                }}
              />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
