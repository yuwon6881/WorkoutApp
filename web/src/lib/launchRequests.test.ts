import {afterEach, expect, it, vi} from 'vitest';
import {coordinateLaunchRequest} from './launchRequests';

afterEach(() => vi.useRealTimers());

it('lets a step refresh follow its cache read before starting lower priority integrations', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const cached = coordinateLaunchRequest('/api/integrations/google-health/sync', 'POST', undefined, async () => {calls.push('cache');});
  const training = coordinateLaunchRequest('/api/training/summary', 'GET', undefined, async () => {calls.push('training');});
  void cached.then(() => {setTimeout(() => {
    void coordinateLaunchRequest('/api/integrations/google-health/sync', 'POST', undefined, async () => {calls.push('refresh');});
  }, 0);});
  await vi.runAllTimersAsync();
  await training;
  expect(calls).toEqual(['cache', 'refresh', 'training']);
});

it('prioritizes bootstrap and steps over optional reads without blocking writes', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  let finish!: () => void;
  const bootstrap = coordinateLaunchRequest('/api/bootstrap', 'GET', undefined, () => {
    calls.push('bootstrap');
    return new Promise<void>(resolve => { finish = resolve; });
  });
  const notification = coordinateLaunchRequest('/api/notifications/status', 'GET', undefined, async () => { calls.push('notifications'); });
  const steps = coordinateLaunchRequest('/api/integrations/google-health/sync', 'POST', undefined, async () => { calls.push('steps'); });
  await coordinateLaunchRequest('/api/sync', 'POST', undefined, async () => { calls.push('write'); });
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual(['bootstrap', 'write']);
  finish();
  await bootstrap;
  await vi.runAllTimersAsync();
  await Promise.all([steps, notification]);
  expect(calls).toEqual(['bootstrap', 'write', 'steps', 'notifications']);
});

it('removes canceled queued reads before they contact the server', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const run = vi.fn();
  const pending = coordinateLaunchRequest('/api/notifications/status', 'GET', controller.signal, run);
  const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
  controller.abort();
  await rejected;
  await vi.runAllTimersAsync();
  expect(run).not.toHaveBeenCalled();
});
