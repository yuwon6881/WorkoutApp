import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

// Execute the document-start script shipped in the APK, rather than a second implementation.
const java = readFileSync(new URL('../../android/app/src/main/java/com/workoutapp/phone/NativeShellUpgrade.java', import.meta.url), 'utf8');
const declaration = java.match(/static final String SCRIPT = ([\s\S]*?);\s*private static final class/)![1];
const script = [...declaration.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => JSON.parse(`"${match[1]}"`)).join('');

function execute(getRegistrations: () => Promise<unknown[]>) {
  const complete = vi.fn();
  const stop = vi.fn();
  const remove = vi.fn().mockResolvedValue(true);
  runInNewContext(script, {
    window: { stop, caches: {} },
    navigator: { serviceWorker: { getRegistrations } },
    location: { origin: 'https://workout.example' }, URL, setTimeout, clearTimeout,
    caches: { keys: async () => ['workbox-precache-v2-https://workout.example/', 'workbox-precache-v2-https://other.example/', 'workout-records'], delete: remove },
    WorkoutShellUpgrade: { complete }
  });
  return { complete, stop, remove };
}

it('stops the previous document before retiring only the owned worker and static cache', async () => {
  const owned = vi.fn().mockResolvedValue(true);
  const foreign = vi.fn();
  const result = execute(async () => [
    { active: { scriptURL: 'https://workout.example/sw.js' }, unregister: owned },
    { active: { scriptURL: 'https://other.example/sw.js' }, unregister: foreign }
  ]);
  expect(result.stop).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(result.complete).toHaveBeenCalledExactlyOnceWith(true));
  expect(owned).toHaveBeenCalledOnce();
  expect(foreign).not.toHaveBeenCalled();
  expect(result.remove).toHaveBeenCalledExactlyOnceWith('workbox-precache-v2-https://workout.example/');
});

it('reports a cleanup failure without acknowledging the native upgrade', async () => {
  const result = execute(async () => { throw new Error('worker storage unavailable'); });
  await vi.waitFor(() => expect(result.complete).toHaveBeenCalledExactlyOnceWith(false));
  expect(result.remove).not.toHaveBeenCalled();
});
