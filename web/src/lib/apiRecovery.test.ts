import {afterEach, expect, it, vi} from 'vitest';
import {api} from './api';

afterEach(() => vi.unstubAllGlobals());

it('preserves a server cooldown that cannot fit the status request deadline', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', {status: 429, headers: {'Retry-After': '120'}}));
  vi.stubGlobal('fetch', fetch);
  await expect(api.googleHealthStatus()).rejects.toMatchObject({status: 429, retryAfterMs: 120000});
  expect(fetch).toHaveBeenCalledTimes(1);
});
