import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadWithFreshShell } from './freshShell';

describe('reloadWithFreshShell', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('unregisters workers and clears caches before reloading', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] } });
    vi.stubGlobal('caches', { keys: async () => ['workbox-precache-v2', 'runtime'], delete: remove });
    const reload = vi.fn();

    await reloadWithFreshShell(reload);

    expect(unregister).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still reloads when clearing fails', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => { throw new Error('blocked'); } } });
    const reload = vi.fn();

    await reloadWithFreshShell(reload);

    expect(reload).toHaveBeenCalledOnce();
  });
});
