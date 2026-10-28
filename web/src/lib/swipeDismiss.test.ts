import { describe, expect, it } from 'vitest';
import { shouldDismiss } from './swipeDismiss';

describe('shouldDismiss', () => {
  it('returns false for 63 px slow movement', () => {
    // 63 px in 200 ms -> 0.315 px/ms
    expect(shouldDismiss(63, 200)).toBe(false);
  });

  it('returns true for 64 px distance regardless of duration', () => {
    expect(shouldDismiss(64, 500)).toBe(true);
  });

  it('returns true for -64 px distance in the opposite direction', () => {
    expect(shouldDismiss(-64, 500)).toBe(true);
  });

  it('returns true for 20 px in 20 ms (1 px/ms velocity)', () => {
    expect(shouldDismiss(20, 20)).toBe(true);
    expect(shouldDismiss(-20, 20)).toBe(true);
  });

  it('returns false for 20 px in 100 ms (0.2 px/ms velocity)', () => {
    expect(shouldDismiss(20, 100)).toBe(false);
  });

  it('does not divide by zero when elapsedMs is 0', () => {
    expect(shouldDismiss(20, 0)).toBe(false);
    expect(shouldDismiss(-20, 0)).toBe(false);
    expect(shouldDismiss(0, 0)).toBe(false);
  });
});
