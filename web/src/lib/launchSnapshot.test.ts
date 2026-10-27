import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, ShellBootstrap } from '../types';
import { clearLaunchSnapshot, readLaunchSnapshot, saveLaunchSnapshot } from './launchSnapshot';

const storage = new Map<string, string>();
const now = Date.UTC(2026, 9, 27, 7, 0);
const day = 24 * 60 * 60 * 1000;

function shell(overrides: Partial<ShellBootstrap> = {}): ShellBootstrap {
  return {
    account: { id: 'owner', displayName: 'Owner' },
    preferences: { unit: 'kg', theme: 'dark', restAlerts: true },
    activeWorkout: null, activeProgram: null, imports: [],
    nextWorkout: null, navigationCounts: { programs: 1, templates: 2 },
    ...overrides
  };
}

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('launch snapshot', () => {
  it('returns the summary saved by the same build', () => {
    saveLaunchSnapshot(shell(), now, '1.0.0+abc');
    expect(readLaunchSnapshot(now + day, '1.0.0+abc')).toEqual(shell());
  });

  it('never reads a summary written by another build', () => {
    saveLaunchSnapshot(shell(), now, '1.0.0+abc');
    expect(readLaunchSnapshot(now, '1.0.1+def')).toBeNull();
  });

  it('drops a summary older than two weeks or dated in the future', () => {
    saveLaunchSnapshot(shell(), now, 'v');
    expect(readLaunchSnapshot(now + 15 * day, 'v')).toBeNull();
    expect(readLaunchSnapshot(now - day, 'v')).toBeNull();
  });

  it('keeps nothing while a workout is open, so Overview never offers Start over a running session', () => {
    saveLaunchSnapshot(shell(), now, 'v');
    saveLaunchSnapshot(shell({ activeWorkout: { id: 'session' } as Session }), now, 'v');
    expect(readLaunchSnapshot(now, 'v')).toBeNull();
  });

  it('leaves import drafts to the live read', () => {
    saveLaunchSnapshot(shell({ imports: [{ id: 'import' }] as ShellBootstrap['imports'] }), now, 'v');
    expect(readLaunchSnapshot(now, 'v')?.imports).toEqual([]);
  });

  it('is removed at sign-out and tolerates unreadable values', () => {
    saveLaunchSnapshot(shell(), now, 'v');
    clearLaunchSnapshot();
    expect(readLaunchSnapshot(now, 'v')).toBeNull();
    storage.set('workout-launch-snapshot', '{not json');
    expect(readLaunchSnapshot(now, 'v')).toBeNull();
  });

  it('falls back to the server when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); }
    });
    expect(() => saveLaunchSnapshot(shell(), now, 'v')).not.toThrow();
    expect(readLaunchSnapshot(now, 'v')).toBeNull();
  });
});
