import { describe, expect, it } from 'vitest';
import { shortSyncStatus } from './workoutSyncStatus';

describe('short workout sync status', () => {
  it('reduces each saving sentence to one word with a tone', () => {
    expect(shortSyncStatus('Saved on this device. Syncing…', true)).toEqual({ label: 'Saving', tone: 'saving' });
    expect(shortSyncStatus('Synced.', true)).toEqual({ label: 'Synced', tone: 'saved' });
    expect(shortSyncStatus('Saved on this device. Waiting for a connection to sync.', false)).toEqual({ label: 'Saved offline', tone: 'offline' });
    expect(shortSyncStatus('This unfinished edit could not be saved on the device.', true)).toEqual({ label: 'Not saved', tone: 'warning' });
  });

  it('says nothing when online and idle, and Offline when not', () => {
    expect(shortSyncStatus('', true)).toBeNull();
    expect(shortSyncStatus('', false)).toEqual({ label: 'Offline', tone: 'offline' });
  });
});
