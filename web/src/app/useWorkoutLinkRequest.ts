import { useEffect, useState } from 'react';
import type { Bootstrap } from '../types';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';

/// Raised by the Android app when its workout notification is tapped while this page is open. The
/// request travels in the address (`?workout=`) exactly as on a cold start, but the page answers
/// it in place: reloading would flash the loading screen, drop the open sheet and scroll position,
/// and interrupt a save that is still on its way.
export const WORKOUT_OPEN_REQUEST_EVENT = 'workout-open-request';

/// Opens the workout named by `?workout=` once it is known whether that workout is still active
/// here, then removes the request from the address so Back and reloads do not repeat it.
export function useWorkoutLinkRequest({ data, recovery, loading, openWorkout, reviewRecovery, notify }: {
  data: Bootstrap | null;
  recovery: WorkoutRecoveryRecord | null;
  loading: boolean;
  openWorkout: () => void;
  reviewRecovery: () => void;
  notify: (message: string) => void;
}) {
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    // The event names the workout in `detail.workoutId`. Cancelling it tells the Android app the
    // page took the request, so it does not fall back to loading the address.
    const requested = (event: Event) => {
      const workoutId = event instanceof CustomEvent ? (event.detail as { workoutId?: unknown } | null)?.workoutId : null;
      if (typeof workoutId !== 'string' || !workoutId) return;
      event.preventDefault();
      const url = new URL(window.location.href);
      url.searchParams.set('workout', workoutId);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      setRequestVersion(version => version + 1);
    };
    window.addEventListener(WORKOUT_OPEN_REQUEST_EVENT, requested);
    return () => window.removeEventListener(WORKOUT_OPEN_REQUEST_EVENT, requested);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('workout');
    if (!requested) return;
    if (recovery?.sessionId === requested && (!data || data.account.id === recovery.accountId)) {
      if (data?.activeWorkout?.active && data.activeWorkout.id !== requested) reviewRecovery();
      openWorkout();
    } else if (data?.activeWorkout?.active && data.activeWorkout.id === requested) openWorkout();
    else if (data && !loading) notify('That workout is no longer active on this device.');
    else return;
    const url = new URL(window.location.href);
    url.searchParams.delete('workout');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    // The callbacks are the shell's state setters; the request is re-read when its inputs change.
  }, [recovery?.sessionId, data?.account.id, data?.activeWorkout?.id, loading, requestVersion]);
}
