import { isNative } from './platform';

// The native app never registers a service worker, so once the former hosted shell is retired there
// is nothing left to find. Remembering that skips two awaited storage reads before first render.
const retiredKey = 'workout-native-shell-retired';

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
  const registrations = await navigator.serviceWorker.getRegistrations();
  const owned = registrations.filter(registration => [registration.active, registration.waiting, registration.installing]
    .some(worker => worker && worker.scriptURL === new URL('/sw.js', location.origin).href));
  await Promise.all(owned.map(registration => registration.unregister()));
  if ('caches' in globalThis) {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('workbox-precache-') && name.endsWith(`${location.origin}/`))
      .map(name => caches.delete(name)));
  }
  if (owned.length && navigator.serviceWorker.controller) {
    // The reload starts a page the old worker no longer controls; its clean pass records the result.
    location.reload();
    return false;
  }
  recordRetired();
  return true;
}
