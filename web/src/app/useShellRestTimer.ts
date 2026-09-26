import { useEffect, useRef, useState } from 'react';
import type { Bootstrap, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { restTimer } from '../lib/restTimer';
import { getWorkoutPushDeviceId } from '../lib/push/firebaseMessaging';
import { setHapticsEnabled } from '../lib/platform';
import type { DevicePreferences, WorkoutRecoveryRecord } from '../lib/workoutRecovery';

/// The rest timer belongs to the shell, so minimizing the workout never stops its deadline, and
/// the server-scheduled rest alert follows it: scheduled when a rest starts on this device,
/// cancelled when it ends or moves, and answered from a visible window instead of a push.
export function useShellRestTimer({ data, recovery, recoverySession, devicePreferences, setToast }: {
  data: Bootstrap | null;
  recovery: WorkoutRecoveryRecord | null;
  recoverySession: Session | null;
  devicePreferences: DevicePreferences;
  setToast: (message: string) => void;
}) {
  // The timer belongs to the shell so minimizing the workout does not stop its deadline. The
  // saved timer is account and session scoped and the notification content stays generic.
  const timerAccountId = data?.account.id ?? recovery?.accountId ?? null;
  const timerSessionId = recovery?.conflict && !recovery.serverSession.active
    ? null : recoverySession?.id ?? data?.activeWorkout?.id ?? null;
  const timerNotifications = data?.preferences.restAlerts ?? recovery?.preferences.restAlerts ?? false;
  const [restState, setRestState] = useState(restTimer.current);
  const [pushWakeVersion, setPushWakeVersion] = useState(0);
  const pushDesired = useRef<{ accountId: string; sessionId: string; generation: string; deviceId: string } | null>(null);
  const pushAttempt = useRef<{ key: string; inFlight: boolean; confirmed: boolean } | null>(null);
  const pushWork = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    restTimer.setScope(timerAccountId, timerSessionId, {
      notifications: timerNotifications,
      sound: devicePreferences.sound,
      vibration: devicePreferences.vibration,
      keepAwake: devicePreferences.keepAwake
    });
    setHapticsEnabled(devicePreferences.vibration);
    return restTimer.attach();
  }, [timerAccountId, timerSessionId, timerNotifications, devicePreferences]);
  useEffect(() => {
    setRestState(restTimer.current);
    return restTimer.subscribe(setRestState);
  }, []);
  useEffect(() => {
    const retry = () => setPushWakeVersion(version => version + 1);
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('workout-rest-push-changed', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('workout-rest-push-changed', retry);
    };
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      const query = event.data;
      const port = event.ports[0];
      if (!port || query?.type !== 'workout-rest-alert-owner-query' ||
        typeof query.sessionId !== 'string' || typeof query.generation !== 'string') return;
      void (async () => {
        const ownsTimer = document.visibilityState === 'visible' && Boolean(timerAccountId) &&
          timerSessionId === query.sessionId &&
          await restTimer.claimBackgroundAlert(timerAccountId!, query.sessionId, query.generation);
        port.postMessage({
          type: 'workout-rest-alert-owner-response',
          sessionId: query.sessionId,
          generation: query.generation,
          ownsTimer
        });
      })().catch(() => {
        port.postMessage({
          type: 'workout-rest-alert-owner-response',
          sessionId: query.sessionId,
          generation: query.generation,
          ownsTimer: false
        });
      });
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [timerAccountId, timerSessionId, restState.generation]);
  useEffect(() => {
    const enqueue = (work: () => Promise<void>) => {
      const next = pushWork.current.then(work, work);
      pushWork.current = next.catch(() => undefined);
      return next;
    };
    const deviceId = getWorkoutPushDeviceId();
    const running = timerNotifications && Boolean(timerAccountId) && Boolean(timerSessionId) &&
      Boolean(deviceId) && typeof Notification !== 'undefined' && Notification.permission === 'granted' &&
      restState.endsAt > Date.now() && !restState.announced && Boolean(restState.generation) && navigator.onLine;

    if (!running || !deviceId || !timerAccountId || !timerSessionId) {
      const previous = pushDesired.current;
      pushDesired.current = null;
      pushAttempt.current = null;
      if (previous && previous.accountId === timerAccountId) {
        void enqueue(async () => {
          try { await api.cancelRestAlert(previous.sessionId, { deviceId: previous.deviceId, generation: previous.generation }); }
          catch { /* Expiring server-side tasks are safe if cancellation cannot reach the server. */ }
        });
      }
      return;
    }

    const next = { accountId: timerAccountId, sessionId: timerSessionId, generation: restState.generation, deviceId };
    const key = `${next.accountId}:${next.sessionId}:${next.generation}`;
    const previous = pushDesired.current;
    if (previous && previous.accountId === next.accountId && previous.sessionId !== next.sessionId) {
      void enqueue(async () => {
        try { await api.cancelRestAlert(previous.sessionId, { deviceId: previous.deviceId, generation: previous.generation }); }
        catch { /* The old task expires shortly and cannot affect the new workout. */ }
      });
    }
    pushDesired.current = next;
    if (pushAttempt.current?.key === key && (pushAttempt.current.inFlight || pushAttempt.current.confirmed)) return;
    if (pushAttempt.current?.key !== key) pushAttempt.current = { key, inFlight: false, confirmed: false };
    pushAttempt.current = { key, inFlight: true, confirmed: false };
    void enqueue(async () => {
      try {
        if (pushDesired.current?.accountId !== next.accountId || pushDesired.current.sessionId !== next.sessionId ||
          pushDesired.current.generation !== next.generation) return;
        const status = await api.restAlertStatus(deviceId, timerSessionId);
        if (!status.configured || !status.registered) {
          pushAttempt.current = { key, inFlight: false, confirmed: false };
          return;
        }
        if (pushDesired.current?.generation !== next.generation) return;
        const result = await api.scheduleRestAlert(timerSessionId, {
          deviceId, generation: restState.generation, deadline: new Date(restState.endsAt).toISOString(),
          expectedGeneration: status.currentGeneration
        });
        const stillCurrent = pushDesired.current?.accountId === next.accountId && pushDesired.current.sessionId === next.sessionId &&
          pushDesired.current.generation === next.generation;
        if (!stillCurrent) {
          try { await api.cancelRestAlert(next.sessionId, { deviceId, generation: next.generation }); } catch { /* The task expires quickly. */ }
          return;
        }
        pushAttempt.current = { key, inFlight: false, confirmed: result.scheduled };
        if (!result.scheduled) setToast(result.message);
      } catch (failure) {
        pushAttempt.current = { key, inFlight: false, confirmed: false };
        if (failure instanceof ApiError && failure.status === 409) setToast(failure.message);
      }
    });
  }, [data?.preferences.restAlerts, pushWakeVersion, restState, timerAccountId, timerNotifications, timerSessionId]);

  return restState;
}
