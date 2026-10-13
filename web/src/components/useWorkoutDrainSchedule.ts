import { useEffect, useRef } from 'react';
import type { SaveQueue } from '../lib/queue';
import { workoutDrainDelay } from '../lib/workoutDrainDelay';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';

/// Sends the durable workout queue after a short pause so a lifter's typing becomes one request.
/// A pause still waiting when the page is hidden or the sheet closes is sent at once, so leaving
/// never strands an edit the watch and other devices are waiting for.
export function useWorkoutDrainSchedule({ online, recovery, queue, drain }: {
  online: boolean;
  recovery: WorkoutRecoveryRecord | null;
  queue: SaveQueue;
  drain: () => Promise<void>;
}) {
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!online || !recovery?.operations.length || recovery.conflict) {
      pending.current = null;
      return;
    }
    const send = () => {
      if (pending.current !== send) return;
      pending.current = null;
      queue.push('workout', drain);
    };
    pending.current = send;
    const timer = setTimeout(send, workoutDrainDelay(recovery));
    return () => clearTimeout(timer);
  }, [online, recovery, queue, drain]);

  useEffect(() => {
    const flush = () => pending.current?.();
    const flushWhenHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
}
