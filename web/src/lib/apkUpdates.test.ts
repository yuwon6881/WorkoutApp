import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ checkApkUpdate: vi.fn(), openApkRelease: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: {}, registerPlugin: () => native }));
vi.mock('@capacitor/app', () => ({ App: {} }));
import { checkApkUpdate, openApkRelease } from './apkUpdates';
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('window', { dispatchEvent: vi.fn() }); });
afterEach(() => vi.unstubAllGlobals());
describe('APK checks', () => {
  it('coalesces checks and preserves the last successful time while offline', async () => {
    native.checkApkUpdate.mockResolvedValueOnce({ status: 'up-to-date', lastSuccessfulCheck: 1000 });
    const first = checkApkUpdate();
    await Promise.all([first, checkApkUpdate()]);
    expect(native.checkApkUpdate).toHaveBeenCalledOnce();
    native.checkApkUpdate.mockRejectedValueOnce(new Error('offline'));
    expect(await checkApkUpdate(true)).toEqual({ status: 'unavailable', lastSuccessfulCheck: 1000 });
    expect(native.checkApkUpdate).toHaveBeenLastCalledWith({ manual: true });
  });
  it('delegates release navigation to a fixed native destination without accepting a web URL', async () => {
    await openApkRelease();
    expect(native.openApkRelease).toHaveBeenCalledWith();
  });
});
