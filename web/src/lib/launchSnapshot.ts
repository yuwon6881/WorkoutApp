import type { ShellBootstrap } from '../types';

// The last launch summary the server sent, kept so a cold start (the first open of the day, after
// Android has closed the app) shows the Overview at once instead of waiting for the API and its
// database to wake. The live launch read always follows and replaces it.
//
// It holds only the compact launch summary: account, preferences, the active slot's summary and the
// next workout. No session, history, program days or import drafts are kept. While a workout is open
// nothing is kept: the recovery store owns that session, and an Overview from before it started
// would offer Start instead of Resume. One account at a time; sign-out removes it.
const storageKey = 'workout-launch-snapshot';
const schemaVersion = 1;
// A summary this old is more likely to mislead than help; the skeleton is shown instead.
const maxAgeMs = 14 * 24 * 60 * 60 * 1000;

type StoredSnapshot = {
  schema: number;
  // A summary written by another build can have a different shape, so it is never read back.
  appVersion: string;
  savedAt: number;
  shell: ShellBootstrap;
};

function currentAppVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';
}

/** The device copy of the last launch summary, when it was written by this build recently. */
export function readLaunchSnapshot(now = Date.now(), appVersion = currentAppVersion()): ShellBootstrap | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredSnapshot>;
    if (stored.schema !== schemaVersion || stored.appVersion !== appVersion) return null;
    if (typeof stored.savedAt !== 'number' || now - stored.savedAt > maxAgeMs || stored.savedAt > now) return null;
    if (!stored.shell?.account?.id || !stored.shell.preferences) return null;
    return stored.shell;
  } catch {
    // Unavailable storage or an unreadable value: the app waits for the server, as it always could.
    return null;
  }
}

/** Keeps the launch summary for the next cold start, leaving out what other stores own. */
export function saveLaunchSnapshot(shell: ShellBootstrap, now = Date.now(), appVersion = currentAppVersion()): void {
  if (shell.activeWorkout) {
    clearLaunchSnapshot();
    return;
  }
  const stored: StoredSnapshot = {
    schema: schemaVersion,
    appVersion,
    savedAt: now,
    shell: { ...shell, activeWorkout: null, imports: [], gym: undefined }
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(stored));
  } catch {
    // A full or disabled store only means the next cold start waits for the server.
  }
}

export function clearLaunchSnapshot(): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Nothing could have been saved when storage is unavailable.
  }
}
