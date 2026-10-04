import { Loader2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Skeleton } from './ui/Skeleton';
import './WorkoutStarting.css';

export function WorkoutStartingContent({ name, status = 'Starting workout…' }: {
  name: string;
  status?: string;
}) {
  return (
    <>
      <div className="workout-top-status-bar" data-sheet-handle="">
        <div className="workout-starting-title">
          <h2>{name}</h2>
          <span className="workout-starting-status" role="status"><Loader2 size={14} className="spin" />{status}</span>
        </div>
      </div>
      <div className="workout-body workout-starting-body" aria-hidden="true">
        <Skeleton className="workout-starting-strip" />
        <Skeleton className="workout-starting-heading" />
        <Skeleton className="workout-starting-card" />
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
      </div>
    </>
  );
}

/// The workout sheet opens on the tap that starts it. The server still builds the session (its
/// suggestions are frozen at start), so this stands in with the sheet's own shape until it
/// arrives; the real sheet then takes its place without rising a second time.
export function WorkoutStarting({ name, status = 'Starting workout…', continues = false, onClose }: {
  name: string;
  status?: string;
  /** Already on screen as an earlier stand-in, so it appears without its entrance motion. */
  continues?: boolean;
  onClose: () => void;
}) {
  return (
    <Modal title={name} onClose={onClose} wide headless className={`workout-sheet workout-starting ${continues ? 'workout-sheet-continued' : ''}`.trim()}>
      <WorkoutStartingContent name={name} status={status} />
    </Modal>
  );
}
