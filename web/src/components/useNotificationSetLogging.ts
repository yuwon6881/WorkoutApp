import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Session, Unit } from '../types';
import { notificationSetTarget } from '../lib/notificationSetLogging';
import { hasNativeWorkoutStore, onNativeLogSet } from '../lib/platform';
import { restTimer } from '../lib/restTimer';

export function useNotificationSetLogging({
  enabled, draft, exerciseIndex, unit, trackRir, log
}: {
  enabled: boolean; draft: Session; exerciseIndex: number; unit: Unit; trackRir: boolean;
  log: (exerciseIndex: number, setIndex: number) => Promise<boolean>;
}) {
  const [listening, setListening] = useState(false);
  const [logging, setLogging] = useState(false);
  const action = useRef<((token: string) => void) | null>(null);
  const inFlight = useRef(false);
  const offer = useRef<{ key: string; token: string } | null>(null);
  const target = enabled && listening && !logging ? notificationSetTarget(draft, exerciseIndex, unit, trackRir) : null;
  const key = target?.key;
  const title = target?.title;
  const values = target?.values;
  const sessionId = draft.id;

  useEffect(() => {
    if (!hasNativeWorkoutStore()) return;
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    void onNativeLogSet(({ token, atMs }) => {
      // A suspended WebView can receive callbacks when it wakes. Do not log an old tap then.
      if (Date.now() - atMs <= 15_000) action.current?.(token);
    }).then(unsubscribe => {
      if (disposed) return unsubscribe();
      remove = unsubscribe;
      setListening(true);
    }).catch(() => { /* No action is advertised if the bridge cannot listen. */ });
    return () => { disposed = true; void remove?.().catch(() => undefined); };
  }, []);

  useLayoutEffect(() => {
    if (key === undefined || title === undefined || values === undefined) return;
    const token = crypto.randomUUID();
    offer.current = { key, token };
    restTimer.setNotificationSetCard(sessionId, { token, title, values });
    return () => {
      offer.current = null;
      restTimer.setNotificationSetCard(sessionId, null);
    };
  }, [sessionId, key, title, values]);

  useLayoutEffect(() => {
    action.current = token => {
      if (!target || offer.current?.token !== token || offer.current.key !== target.key ||
          inFlight.current || restTimer.remainingMs > 0) return;
      inFlight.current = true;
      setLogging(true);
      void log(target.exerciseIndex, target.setIndex).finally(() => {
        inFlight.current = false;
        setLogging(false);
      });
    };
    return () => { action.current = null; };
  });
}
