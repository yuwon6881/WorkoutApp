import { useSyncExternalStore } from 'react';

// The one window-size contract, matching the CSS tiers: compact below 640 px, medium through
// 1023 px, expanded from 1024 px. Pointer type chooses optional gestures, never layout.
export type WindowTier = 'compact' | 'medium' | 'expanded';

const COMPACT = '(max-width: 639px)';
const EXPANDED = '(min-width: 1024px)';

export function windowTier(): WindowTier {
  if (typeof window === 'undefined' || !window.matchMedia) return 'expanded';
  if (window.matchMedia(COMPACT).matches) return 'compact';
  return window.matchMedia(EXPANDED).matches ? 'expanded' : 'medium';
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const queries = [window.matchMedia(COMPACT), window.matchMedia(EXPANDED)];
  queries.forEach(query => query.addEventListener('change', onChange));
  return () => queries.forEach(query => query.removeEventListener('change', onChange));
}

export function useWindowTier(): WindowTier {
  return useSyncExternalStore(subscribe, windowTier, () => 'expanded');
}
