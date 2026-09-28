export type SyncTone = 'saving' | 'saved' | 'offline' | 'warning';

// The status line's sentences, reduced to the word a lifter needs at a glance.
export function shortSyncStatus(message: string, online: boolean): { label: string; tone: SyncTone } | null {
  if (!message) return online ? null : { label: 'Offline', tone: 'offline' };
  if (/review|conflict/i.test(message)) return { label: 'Needs review', tone: 'warning' };
  if (/could not|not recoverable|unavailable/i.test(message)) return { label: 'Not saved', tone: 'warning' };
  if (/finished/i.test(message)) return { label: 'Finished', tone: online ? 'saving' : 'offline' };
  if (/syncing/i.test(message)) return { label: 'Saving', tone: 'saving' };
  if (/synced|saved to the server/i.test(message)) return { label: 'Synced', tone: 'saved' };
  if (/saved on (this )?device/i.test(message) || !online || /waiting for a connection|reconnect|offline/i.test(message))
    return { label: 'Saved on device', tone: online ? 'saved' : 'offline' };
  return { label: 'Saving', tone: 'saving' };
}
