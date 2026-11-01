import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptic, setHapticsEnabled, type Haptic } from './platform';

const KINDS: Haptic[] = ['tick', 'detent', 'log', 'success', 'warning'];

function stubVibrate() {
  const vibrate = vi.fn((_pattern: number | number[]) => true);
  vi.stubGlobal('navigator', { vibrate });
  return vibrate;
}

describe('haptic', () => {
  afterEach(() => {
    setHapticsEnabled(true);
    vi.unstubAllGlobals();
  });

  it('gives each kind its own browser pattern, a detent firmer than a tick', () => {
    const vibrate = stubVibrate();
    for (const kind of KINDS) haptic(kind);
    const patterns = vibrate.mock.calls.map(call => JSON.stringify(call[0]));
    expect(new Set(patterns).size).toBe(KINDS.length);
    expect(vibrate).toHaveBeenNthCalledWith(1, 8);
    expect(vibrate).toHaveBeenNthCalledWith(2, 12);
  });

  it('stays silent when the device vibration preference is off', () => {
    const vibrate = stubVibrate();
    setHapticsEnabled(false);
    haptic('detent');
    expect(vibrate).not.toHaveBeenCalled();
  });
});
