import {afterEach, expect, it, vi} from 'vitest';
import {IntegrationRecovery} from './integrationRecovery';
afterEach(() => vi.useRealTimers());

it('coalesces callers and stops after two automatic recovery attempts', async () => {
  vi.useFakeTimers();
  const recovery = new IntegrationRecovery();
  const run = vi.fn(async () => { recovery.schedule(run); throw new Error('Still unavailable'); });
  recovery.schedule(run);
  recovery.schedule(run);
  await vi.advanceTimersByTimeAsync(30000);
  expect(run).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  recovery.reset();
  recovery.schedule(run);
  recovery.reset();
  await vi.runAllTimersAsync();
  expect(run).toHaveBeenCalledTimes(2);
});
