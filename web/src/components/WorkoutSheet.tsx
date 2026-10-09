import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './ui/Modal';
import { WorkoutStartingContent } from './WorkoutStarting';
import './WorkoutSheet.css';

/// The workout sheet opens on the tap that starts it. The server still builds the session (its
/// suggestions are frozen at start), so the sheet stands in with its own shape until the workout
/// arrives, and the real workout then takes its place inside the same sheet without rising again.
/// It is its own module so the dialog stays out of the first load; the shell warms it at idle.
export function WorkoutSheet({ title, continues, onClose, children }: {
  title: string;
  /** Already on screen as the stand-in, so the workout appears without a second entrance. */
  continues: boolean;
  onClose: () => void;
  /** The workout itself, once there is a session; until then the sheet shows the stand-in. */
  children?: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose} wide headless animateExit
      className={`workout-sheet ${continues ? 'workout-sheet-continued' : ''}`.trim()}>
      {children ? (
        <Suspense fallback={<WorkoutStartingContent name={title} status="Opening workout…" />}>{children}</Suspense>
      ) : (
        <WorkoutStartingContent name={title} status="Starting workout…" />
      )}
    </Modal>
  );
}
