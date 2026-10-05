import { afterEach, expect, it, vi } from 'vitest';
import { defaultDevicePreferences, saveDevicePreferences } from './workoutDevicePreferences';

afterEach(() => vi.unstubAllGlobals());
it('reports persistence refusal so Settings can revert the visible switch', async () => {
  vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Storage is unavailable'); } });
  await expect(saveDevicePreferences('account', defaultDevicePreferences)).rejects.toThrow('Storage is unavailable');
});
