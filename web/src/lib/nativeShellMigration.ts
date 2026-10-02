import { isNative } from './platform';

/** Retires the former hosted shell without touching account or workout stores. */
export async function prepareNativeShell(): Promise<boolean> {
  if (!isNative() || !('serviceWorker' in navigator)) return true;
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
    location.reload();
    return false;
  }
  return true;
}
