import { useEffect } from 'react';
import type { RestState } from '../lib/restTimer';
import { useShellRestTimer } from './useShellRestTimer';

/// Drives the shell's rest timer from its own chunk: the timer, alarm and rest-alert scheduling are
/// not needed for first paint, so the shell mounts this beside every screen and receives the rest
/// state once it is running.
export function ShellRestTimer({ onState, ...options }: Parameters<typeof useShellRestTimer>[0] & {
  onState: (state: RestState) => void;
}) {
  const restState = useShellRestTimer(options);
  useEffect(() => { onState(restState); }, [restState, onState]);
  return null;
}
