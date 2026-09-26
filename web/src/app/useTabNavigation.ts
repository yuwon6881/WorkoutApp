import { useCallback, useEffect, useRef, useState } from 'react';
import { backStack } from '../lib/backStack';
import { haptic } from '../lib/platform';

export type Tab = 'overview' | 'program' | 'body' | 'exercises' | 'import' | 'settings';

// Paths are part of the deployment contract: vercel.json serves the shell for each of them.
export const TAB_PATHS: Record<Tab, string> = {
  overview: '/',
  program: '/workouts',
  body: '/muscles',
  exercises: '/exercises',
  import: '/import',
  settings: '/settings'
};

export function tabFromPath(pathname: string): Tab {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const match = (Object.entries(TAB_PATHS) as Array<[Tab, string]>).find(([, path]) => path === normalized);
  return match?.[0] ?? 'overview';
}

function initialTab(): Tab {
  if (typeof window === 'undefined') return 'overview';
  // A central sign-in error returns to the shell with the error in the query; Settings explains it.
  if (/[?&](central_error|error)=/.test(window.location.search)) return 'settings';
  return tabFromPath(window.location.pathname);
}

// The address always names the open tab, so a reload or Back lands where the user was. Opening
// the app straight onto a secondary tab still gives Back somewhere to go inside the app:
// Overview sits beneath it, so the first Back returns home and the next one leaves.
function alignHistory(tab: Tab) {
  const { search, hash } = window.location;
  const address = `${TAB_PATHS[tab]}${search}${hash}`;
  if (tab === 'overview' || window.history.length > 1) {
    window.history.replaceState(window.history.state, '', address);
    return;
  }
  window.history.replaceState({ overlayDepth: 0 }, '', TAB_PATHS.overview);
  window.history.pushState({ overlayDepth: 0 }, '', address);
}

export function useTabNavigation() {
  const [tab, setTabState] = useState<Tab>(initialTab);
  const current = useRef(tab);
  current.current = tab;

  useEffect(() => {
    const stack = backStack();
    if (!stack) return;
    alignHistory(tab);
    return stack.onNavigate(path => {
      const next = tabFromPath(path);
      // Back that only closed a sheet keeps the tab and its scroll position.
      if (next === current.current) return;
      setTabState(next);
      window.scrollTo({ top: 0 });
    });
    // The stack is shared for the page's lifetime; subscribing once is intended.
  }, []);

  const setTab = useCallback((next: Tab) => {
    if (current.current === next) return;
    backStack()?.navigate(TAB_PATHS[next]);
    haptic('tick');
    setTabState(next);
    // A new tab opens at its top rather than halfway down, where the last tab was left.
    window.scrollTo({ top: 0 });
  }, []);

  return { tab, setTab };
}
