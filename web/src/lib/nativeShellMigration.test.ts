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
