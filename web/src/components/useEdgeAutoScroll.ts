import { useCallback, useEffect, useMemo, useRef } from 'react';
import { windowTier } from '../lib/breakpoints';

/// While something is dragged, holding the pointer near the top or bottom edge scrolls the page,
/// faster the closer it gets, until the pointer moves away or the drag ends. The compact bottom
/// navigation is excluded from the bottom edge. `onScroll` lets the caller re-read what is under
/// a pointer that stayed still while the page moved beneath it.
export function useEdgeAutoScroll(onScroll?: () => void) {
  const state = useRef<{ frame: number; speed: number }>({ frame: 0, speed: 0 });
  const callback = useRef(onScroll);
  useEffect(() => { callback.current = onScroll; }, [onScroll]);

  const stop = useCallback(() => {
    cancelAnimationFrame(state.current.frame);
    state.current = { frame: 0, speed: 0 };
  }, []);

  const update = useCallback((clientY: number) => {
    const zone = 88;
    const bottomChrome = windowTier() === 'compact' ? 76 : 0;
    const bottomEdge = window.innerHeight - bottomChrome;
    const speed = clientY < zone ? -(zone - clientY) / 6 : clientY > bottomEdge - zone ? (clientY - (bottomEdge - zone)) / 6 : 0;
    state.current.speed = speed;
    if (!speed) { stop(); return; }
    if (state.current.frame) return;
    const tick = () => {
      if (!state.current.speed) { state.current.frame = 0; return; }
      window.scrollBy(0, state.current.speed);
      callback.current?.();
      state.current.frame = requestAnimationFrame(tick);
    };
    state.current.frame = requestAnimationFrame(tick);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return useMemo(() => ({ update, stop }), [update, stop]);
}
