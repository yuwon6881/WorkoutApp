import { useEffect, useState } from 'react';
import { applyAppUpdate } from '../lib/appUpdate';

// A new deployment waits instead of taking over: reloading on its own could interrupt a set being
// typed. The shell offers the update when no workout is open, and the lifter chooses when.
export function useAppUpdate() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The Android app loads the same deployed origin (capacitor.config.ts), so the worker also
    // keeps it usable offline there.
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      registerSW({
        immediate: true,
        onNeedRefresh: () => setReady(true)
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return { ready, apply: () => {
    void applyAppUpdate(
      () => navigator.serviceWorker.getRegistration(),
      async () => {
        // Workbox classifies updates installed by a sibling tab as external; those
        // do not always trigger its automatic reload. A requested takeover must reload
        // this tab regardless of which tab installed the worker.
        navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      },
      () => window.location.reload()
    );
  } };
}
