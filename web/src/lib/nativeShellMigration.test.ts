import { afterEach, expect, it, vi } from 'vitest';
import { isNative } from './platform';
import { prepareNativeShell } from './nativeShellMigration';

vi.mock('./platform', () => ({ isNative: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('leaves browser service workers and storage untouched', async () => {
  vi.mocked(isNative).mockReturnValue(false);
  const registrations = vi.fn();
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: registrations } });
  expect(await prepareNativeShell()).toBe(true);
  expect(registrations).not.toHaveBeenCalled();
});

it('retires only the native origin worker and its precache before mounting', async () => {
  vi.mocked(isNative).mockReturnValue(true);
  const unregister = vi.fn().mockResolvedValue(true);
  const foreign = vi.fn();
  const reload = vi.fn();
  vi.stubGlobal('location', { origin: 'https://workout.example', reload });
  vi.stubGlobal('navigator', { serviceWorker: { controller: {}, getRegistrations: vi.fn().mockResolvedValue([
    { active: { scriptURL: 'https://workout.example/sw.js' }, unregister },
    { active: { scriptURL: 'https://another.example/sw.js' }, unregister: foreign }
  ]) } });
  const remove = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue([
    'workbox-precache-v2-https://workout.example/', 'workbox-precache-v2-https://another.example/', 'workout-records'
  ]), delete: remove });
  expect(await prepareNativeShell()).toBe(false);
  expect(unregister).toHaveBeenCalledOnce();
  expect(foreign).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledExactlyOnceWith('workbox-precache-v2-https://workout.example/');
  expect(reload).toHaveBeenCalledOnce();
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }
  };
}

it('skips the storage checks on launches after the old shell was retired', async () => {
  vi.mocked(isNative).mockReturnValue(true);
  const registrations = vi.fn();
  const cacheKeys = vi.fn();
  vi.stubGlobal('localStorage', memoryStorage({ 'workout-native-shell-retired': '1' }));
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: registrations } });
  vi.stubGlobal('caches', { keys: cacheKeys });
  expect(await prepareNativeShell()).toBe(true);
  expect(registrations).not.toHaveBeenCalled();
  expect(cacheKeys).not.toHaveBeenCalled();
});

it('records a clean pass so later launches skip it', async () => {
  vi.mocked(isNative).mockReturnValue(true);
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('location', { origin: 'https://workout.example', reload: vi.fn() });
  vi.stubGlobal('navigator', { serviceWorker: { controller: null, getRegistrations: vi.fn().mockResolvedValue([]) } });
  vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue([]), delete: vi.fn() });
  expect(await prepareNativeShell()).toBe(true);
  expect(storage.values.get('workout-native-shell-retired')).toBe('1');
});

it('does not record the pass that reloads, so the clean pass after the reload does', async () => {
  vi.mocked(isNative).mockReturnValue(true);
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('location', { origin: 'https://workout.example', reload: vi.fn() });
  vi.stubGlobal('navigator', { serviceWorker: { controller: {}, getRegistrations: vi.fn().mockResolvedValue([
    { active: { scriptURL: 'https://workout.example/sw.js' }, unregister: vi.fn().mockResolvedValue(true) }
  ]) } });
  vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue([]), delete: vi.fn() });
  expect(await prepareNativeShell()).toBe(false);
  expect(storage.values.has('workout-native-shell-retired')).toBe(false);
});

it('still runs the cleanup when browser storage is unavailable', async () => {
  vi.mocked(isNative).mockReturnValue(true);
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('storage disabled'); },
    setItem: () => { throw new Error('storage disabled'); }
  });
  const registrations = vi.fn().mockResolvedValue([]);
  vi.stubGlobal('location', { origin: 'https://workout.example', reload: vi.fn() });
  vi.stubGlobal('navigator', { serviceWorker: { controller: null, getRegistrations: registrations } });
  vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue([]), delete: vi.fn() });
  expect(await prepareNativeShell()).toBe(true);
  expect(registrations).toHaveBeenCalledOnce();
});
