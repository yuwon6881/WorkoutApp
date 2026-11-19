import { isNative } from './platform';
import { reloadStartupOnce } from './startupRetry';

// The native app never registers a service worker, so once the former hosted shell is retired there
// is nothing left to find. Remembering that skips two awaited storage reads before first render.
const retiredKey = 'workout-native-shell-retired';
const cleanupTimeoutMs = 10_000;

function alreadyRetired(): boolean {
  try {
    return localStorage.getItem(retiredKey) === '1';
  } catch {
    // Storage can be unavailable; the cleanup then runs on every launch, as before.
    return false;
  }
}

function recordRetired(): void {
  try {
    localStorage.setItem(retiredKey, '1');
  } catch {
    // Not recording only repeats the cleanup on the next launch.
  }
}

/** Retires the former hosted shell without touching account or workout stores. */
export async function prepareNativeShell(): Promise<boolean> {
  if (!isNative() || !('serviceWorker' in navigator)) return true;
  if (alreadyRetired()) return true;
  let active = true;
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = async (): Promise<boolean> => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!active) return true;
    const owned = registrations.filter(registration => [registration.active, registration.waiting, registration.installing]
      .some(worker => worker && worker.scriptURL === new URL('/sw.js', location.origin).href));
    await Promise.all(owned.map(registration => registration.unregister()));
    if (!active) return true;
    if ('caches' in globalThis) {
      const names = await caches.keys();
      if (!active) return true;
      await Promise.all(names.filter(name => name.startsWith('workbox-precache-') && name.endsWith(`${location.origin}/`))
        .map(name => caches.delete(name)));
      if (!active) return true;
    }
    if (owned.length && navigator.serviceWorker.controller) {
      // The reload starts a page the old worker no longer controls; its clean pass records the result.
      return reloadStartupOnce() ? false : true;
    }
    if (active) recordRetired();
    return true;
  };
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => { active = false; resolve(null); }, cleanupTimeoutMs);
  });
  try {
    const result = await Promise.race([cleanup(), timeout]);
    if (result !== null) return result;
    return reloadStartupOnce() ? false : true;
  } finally {
    clearTimeout(timer!);
  }
}
