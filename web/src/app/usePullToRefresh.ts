import { useEffect, useRef, useState } from 'react';

const TRIGGER_PX = 72;
const MAX_PULL_PX = 110;
const RESISTANCE = 0.5;

/// Pulling down from the very top of a page refreshes it, as it does in native apps. An installed
/// app has no browser reload gesture, and inside the Android app there is no browser at all. The
/// gesture only starts at the top of the page with no dialog open, so scrolling never triggers it.
export function usePullToRefresh(onRefresh: () => Promise<unknown>, enabled: boolean) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let distance = 0;

    const onStart = (event: TouchEvent) => {
      const atTop = window.scrollY <= 0 && !document.documentElement.classList.contains('dialog-open');
      startY = atTop && event.touches.length === 1 ? event.touches[0].clientY : null;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      const delta = event.touches[0].clientY - startY;
      if (delta <= 0 || window.scrollY > 0) { startY = null; setPull(0); return; }
      distance = Math.min(MAX_PULL_PX, delta * RESISTANCE);
      setPull(distance);
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      setPull(0);
      if (distance < TRIGGER_PX) return;
      setRefreshing(true);
      void latest.current().finally(() => setRefreshing(false));
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);

  return { pull, refreshing, ready: pull >= TRIGGER_PX };
}
