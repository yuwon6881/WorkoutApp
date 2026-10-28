import { describe, expect, it } from 'vitest';
import { classifyGesture, settleOpen, SWIPE_SLOP_PX } from './rowSwipe';

describe('classifyGesture', () => {
  it('returns undecided while max(|dx|, |dy|) < SWIPE_SLOP_PX', () => {
    expect(SWIPE_SLOP_PX).toBe(6);
    expect(classifyGesture(0, 0)).toBe('undecided');
    expect(classifyGesture(5, 5)).toBe('undecided');
    expect(classifyGesture(-5, 4)).toBe('undecided');
  });

  it('returns horizontal when reaching slop horizontally', () => {
    expect(classifyGesture(6, 0)).toBe('horizontal');
    expect(classifyGesture(-6, 3)).toBe('horizontal');
  });

  it('allows slightly diagonal movements to count as horizontal', () => {
    // |dy| is not > |dx| * 1.5, so it classifies as horizontal
    expect(classifyGesture(10, 10)).toBe('horizontal');
    expect(classifyGesture(10, 15)).toBe('horizontal');
    expect(classifyGesture(-10, 15)).toBe('horizontal');
  });

  it('returns vertical only when |dy| > |dx| * 1.5', () => {
    expect(classifyGesture(0, 6)).toBe('vertical');
    expect(classifyGesture(10, 16)).toBe('vertical');
    expect(classifyGesture(-10, -16)).toBe('vertical');
  });
});

describe('settleOpen', () => {
  const actionsWidth = 100;

  it('opens on leftward fling (velocity <= -0.4 px/ms)', () => {
    expect(settleOpen({ wasOpen: false, offset: -10, velocityPxPerMs: -0.4, actionsWidth })).toBe(true);
    expect(settleOpen({ wasOpen: false, offset: -5, velocityPxPerMs: -0.8, actionsWidth })).toBe(true);
  });

  it('closes on rightward fling (velocity >= 0.4 px/ms)', () => {
    expect(settleOpen({ wasOpen: true, offset: -90, velocityPxPerMs: 0.4, actionsWidth })).toBe(false);
    expect(settleOpen({ wasOpen: true, offset: -80, velocityPxPerMs: 0.7, actionsWidth })).toBe(false);
  });

  it('when not already open: opens when final offset is past 30% of actionsWidth', () => {
    // 30% of 100 is 30, so offset <= -30 opens
    expect(settleOpen({ wasOpen: false, offset: -29, velocityPxPerMs: 0, actionsWidth })).toBe(false);
    expect(settleOpen({ wasOpen: false, offset: -30, velocityPxPerMs: 0, actionsWidth })).toBe(true);
    expect(settleOpen({ wasOpen: false, offset: -50, velocityPxPerMs: 0, actionsWidth })).toBe(true);
  });

  it('when already open: closes when dragged back more than 30%', () => {
    // actionsWidth 100, open offset was -100.
    // Dragged back > 30% means offset > -70 (e.g. -69), which closes (returns false).
    // Dragged back <= 30% means offset <= -70 (e.g. -70 or -75), which stays open (returns true).
    expect(settleOpen({ wasOpen: true, offset: -70, velocityPxPerMs: 0, actionsWidth })).toBe(true);
    expect(settleOpen({ wasOpen: true, offset: -80, velocityPxPerMs: 0, actionsWidth })).toBe(true);
    expect(settleOpen({ wasOpen: true, offset: -69, velocityPxPerMs: 0, actionsWidth })).toBe(false);
    expect(settleOpen({ wasOpen: true, offset: -20, velocityPxPerMs: 0, actionsWidth })).toBe(false);
  });
});
