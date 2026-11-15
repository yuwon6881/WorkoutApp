import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeCssAnimation {
  constructor(public animationName: string, public startTime: number | null) {}
}

function install(animations: FakeCssAnimation[]) {
  let notify: () => void = () => undefined;
  vi.stubGlobal('CSSAnimation', FakeCssAnimation);
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { notify = callback; } observe() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 0; });
  vi.stubGlobal('document', { getAnimations: () => animations, querySelector: () => ({}), documentElement: {} });
  return () => notify();
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('syncSkeletonShimmer', () => {
  it('pins a placeholder that appears mid-sweep to the timeline origin, and leaves other animations alone', async () => {
    const shimmer = new FakeCssAnimation('skeleton-shimmer', 740);
    const other = new FakeCssAnimation('card-settle', 120);
    const running = [shimmer, other];
    const mutate = install(running);
    const { syncSkeletonShimmer } = await import('./skeletonShimmer');

    syncSkeletonShimmer();
    expect(shimmer.startTime).toBe(0);

    const late = new FakeCssAnimation('skeleton-shimmer', 1900);
    shimmer.startTime = 0;
    running.push(late);
    mutate();

    expect(late.startTime).toBe(0);
    expect(other.startTime).toBe(120);
  });
});
