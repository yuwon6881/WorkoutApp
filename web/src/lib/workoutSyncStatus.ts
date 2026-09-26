export type SyncTone = 'saving' | 'saved' | 'offline' | 'warning';

// The status line's sentences, reduced to the word a lifter needs at a glance.
export function shortSyncStatus(message: string, online: boolean): { label: string; tone: SyncTone } | null {
  if (!message) return online ? null : { label: 'Offline', tone: 'offline' };
  if (/could not|not recoverable|unavailable/i.test(message)) return { label: 'Not saved', tone: 'warning' };
  if (/finished/i.test(message)) return { label: 'Finished', tone: online ? 'saving' : 'offline' };
  if (!online || /waiting for a connection|reconnect/i.test(message)) return { label: 'Saved offline', tone: 'offline' };
  if (/synced|saved to the server/i.test(message)) return { label: 'Synced', tone: 'saved' };
  return { label: 'Saving', tone: 'saving' };
}
