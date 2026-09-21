import { hasPendingTimingOperations } from '../lib/workoutRecovery';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { Button } from './ui/Button';

export function WorkoutRecoveryConflict({ recovery, online, onResolve }: {
  recovery: WorkoutRecoveryRecord;
  online: boolean;
  onResolve: (choice: 'server' | 'local') => void;
}) {
  const timingConflict = hasPendingTimingOperations(recovery);
  return <div className="error-banner workout-recovery-conflict" role="alert">
    <span>This workout changed on another device. Your on-device copy is preserved.{timingConflict ? ' Pause timing also changed, so the local copy cannot be safely merged.' : ''}</span>
    <div className="setting-action-controls">
      <Button variant="secondary" onClick={() => onResolve('server')}>Use server copy</Button>
      <Button variant="primary" disabled={!online || !recovery.serverSession.active || timingConflict} onClick={() => onResolve('local')}>Apply on-device copy</Button>
    </div>
  </div>;
}
