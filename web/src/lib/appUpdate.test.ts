import { describe, expect, it, vi } from 'vitest';
import { applyAppUpdate } from './appUpdate';

describe('requested app update', () => {
  it('activates a waiting worker before allowing the registration helper to reload', async () => {
    const activate = vi.fn(async () => undefined);
    const reload = vi.fn();
    await applyAppUpdate(async () => ({ waiting: {} } as ServiceWorkerRegistration), activate, reload);
    expect(activate).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([undefined, { waiting: null }])('reloads when the update was already activated: %s', async registration => {
    const activate = vi.fn(async () => undefined);
    const reload = vi.fn();
    await applyAppUpdate(async () => registration as ServiceWorkerRegistration | undefined, activate, reload);
    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still reloads when the browser cannot inspect the registration', async () => {
    const reload = vi.fn();
    await applyAppUpdate(async () => { throw new Error('unavailable'); }, async () => undefined, reload);
    expect(reload).toHaveBeenCalledOnce();
  });
});
