// A plain reload is answered by the service worker's precache. After a deploy that cache can still
// hold the previous index.html, whose hashed chunks no longer exist, so the same failure repeats and
// the Reload button appears to do nothing. Dropping the worker and its caches forces the next load
// to fetch the new shell from the network; the worker registers itself again on that load.
// Only static-shell caches are cleared: the active workout lives in IndexedDB and is untouched.
const SETTLE_LIMIT_MS = 3000;

async function dropShellCaches(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  }
  if ('caches' in globalThis) {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
  }
}

export async function reloadWithFreshShell(reload: () => void = () => location.reload()): Promise<void> {
  // Never let a hung storage call keep the lifter on the error screen.
  const limit = new Promise<void>(resolve => setTimeout(resolve, SETTLE_LIMIT_MS));
  try {
    await Promise.race([dropShellCaches(), limit]);
  } catch {
    // Reloading anyway is still better than staying on the error screen.
  }
  reload();
}
