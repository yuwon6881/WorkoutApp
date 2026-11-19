const STARTUP_RELOAD_KEY = 'workout-startup-reload';

/** Reloads once per tab after a startup stall; a successful app load clears the marker. */
export function reloadStartupOnce(): boolean {
  try {
    if (sessionStorage.getItem(STARTUP_RELOAD_KEY) === '1') return false;
    sessionStorage.setItem(STARTUP_RELOAD_KEY, '1');
    location.reload();
    return true;
  } catch {
    return false;
  }
}

export function clearStartupReloadAttempt(): void {
  try { sessionStorage.removeItem(STARTUP_RELOAD_KEY); } catch { /* Storage is optional. */ }
}