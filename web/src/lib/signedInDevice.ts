// Whether this device was signed in when it last loaded, so a cold start can draw the right first
// frame: the Overview skeleton for a returning lifter, a neutral logo for anyone else, instead of an
// Overview shape that turns into the sign-in card. It is only a hint for that first frame; the
// session check decides what is shown. public/boot-shell.js reads the same keys before scripts run.
const storageKey = 'workout-signed-in';
const launchSnapshotKey = 'workout-launch-snapshot';

export function markSignedInDevice(): void {
  try { localStorage.setItem(storageKey, '1'); } catch { /* The skeleton simply is not chosen next time. */ }
}

export function forgetSignedInDevice(): void {
  try { localStorage.removeItem(storageKey); } catch { /* Nothing could have been saved. */ }
}

export function deviceWasSignedIn(): boolean {
  try { return Boolean(localStorage.getItem(storageKey) || localStorage.getItem(launchSnapshotKey)); } catch { return true; }
}
