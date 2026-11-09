import { describe, expect, it } from 'vitest';
import { GestureVelocity } from './gestureVelocity';

describe('time-based release velocity', () => {
  it.each([60, 120, 240])('uses a comparable window at %i Hz', hz => {
    const velocity = new GestureVelocity();
    for (let at = 0; at <= 200; at += 1000 / hz) velocity.add(at * 0.8, at);
    expect(velocity.at(200)).toBeCloseTo(0.8);
  });
  it('does not dismiss from a stale flick after the finger pauses', () => {
    const velocity = new GestureVelocity();
    velocity.add(0, 0); velocity.add(20, 10);
    expect(velocity.at(150)).toBe(0);
  });
  it('handles reversals and duplicate timestamps without infinite velocity', () => {
    const velocity = new GestureVelocity();
    velocity.add(0, 0); velocity.add(20, 20); velocity.add(10, 20); velocity.add(-10, 40);
    expect(velocity.at(40)).toBeLessThan(0);
  });
});
