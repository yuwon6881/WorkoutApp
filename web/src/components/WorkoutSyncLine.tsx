import { Cloud, CloudOff } from 'lucide-react';

/// Where the latest change is saved. The line keeps its height when empty so a status that comes
/// and goes with every logged set never shifts the exercise under the lifter's thumb.
export function WorkoutSyncLine({ message, online }: { message: string; online: boolean }) {
  return (
    <p className={`workout-sync-line ${online ? '' : 'offline'}`.trim()} role="status">
      {message && (online ? <Cloud size={14} aria-hidden="true" /> : <CloudOff size={14} aria-hidden="true" />)}
      <span>{message}</span>
    </p>
  );
}
