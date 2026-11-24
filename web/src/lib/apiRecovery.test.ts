import {afterEach, expect, it, vi} from 'vitest';
import {api} from './api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('preserves a server cooldown that cannot fit the status request deadline', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', {status: 429, headers: {'Retry-After': '120'}}));
  vi.stubGlobal('fetch', fetch);
  await expect(api.googleHealthStatus()).rejects.toMatchObject({status: 429, retryAfterMs: 120000});
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps one start identity through a wakeup rejection and a lost response', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('No available instance', { status: 429 }))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(new Response('{"id":"session"}'));
  vi.stubGlobal('fetch', fetch);
  const started = api.startWorkout('plan');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await started).toMatchObject({ id: 'session' });
  expect(fetch).toHaveBeenCalledTimes(3);
  const body = fetch.mock.calls[0][1].body;
  expect(JSON.parse(body)).toMatchObject({ templateId: 'plan', mutationId: expect.any(String) });
  for (const [path, options] of fetch.mock.calls) {
    expect(path).toBe('/api/workouts');
    expect(options.body).toBe(body);
  }
});

it('returns a rejected workout plan immediately', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"message":"That slot is a rest day."}', { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  await expect(api.startWorkout('plan')).rejects.toMatchObject({ status: 409, message: 'That slot is a rest day.' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
