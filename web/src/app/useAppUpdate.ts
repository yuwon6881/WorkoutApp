import { useEffect, useRef, useState } from 'react';

// A new deployment waits instead of taking over: reloading on its own could interrupt a set being
// typed. The shell offers the update when no workout is open, and the lifter chooses when.
export function useAppUpdate() {
  const [ready, setReady] = useState(false);
  const apply = useRef<(reload?: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    // The Android app loads the same deployed origin (capacitor.config.ts), so the worker also
    // keeps it usable offline there.
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      apply.current = registerSW({
        immediate: true,
        onNeedRefresh: () => setReady(true)
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return { ready, apply: () => void apply.current(true) };
}
