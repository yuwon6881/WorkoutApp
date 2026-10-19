import type { Tab } from '../app/useTabNavigation';

/// Verified Android App Links claim only `/open/…`. Sign-in and web Google Health consent return to
/// the tab paths in the browser; claiming those would pull the redirect into the app and strand the
/// browser session. Consent started from the app returns through `/open/settings` instead, so the app
/// can finish it (lib/googleHealthBrowser.ts). Hosting redirects each `/open/…` link to its tab for browsers.
export const APP_LINK_TABS: Readonly<Record<string, Tab>> = {
  '/open': 'overview',
  '/open/workouts': 'program',
  '/open/muscles': 'body',
  '/open/exercises': 'exercises',
  '/open/import': 'import',
  '/open/settings': 'settings'
};

export const APP_LINK_EVENT = 'workout:app-link';

export function appLinkTab(raw: unknown, origin: string): Tab | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.host !== new URL(origin).host) return null;
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
    return Object.hasOwn(APP_LINK_TABS, path) ? APP_LINK_TABS[path] : null;
  } catch {
    return null;
  }
}
