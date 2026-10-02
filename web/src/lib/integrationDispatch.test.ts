import { afterEach, expect, it, vi } from 'vitest';
import { beginIntegrationBurst, integrationGeneration, resetIntegrationDispatch, signalIntegrationPending } from './integrationDispatch';

afterEach(() => { resetIntegrationDispatch(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('coalesces acknowledged saves after their burst and ignores the previous account', async () => {
  vi.useFakeTimers();
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  const epoch = integrationGeneration();
  const finish = beginIntegrationBurst();
  signalIntegrationPending(epoch);
  await vi.advanceTimersByTimeAsync(1000);
  expect(dispatchEvent).not.toHaveBeenCalled();
  signalIntegrationPending(epoch);
  finish();
  await vi.advanceTimersByTimeAsync(250);
  expect(dispatchEvent).toHaveBeenCalledTimes(1);
  resetIntegrationDispatch();
  signalIntegrationPending(epoch);
  await vi.advanceTimersByTimeAsync(1000);
  expect(dispatchEvent).toHaveBeenCalledTimes(1);
});
