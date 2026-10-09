import { describe, expect, it } from 'vitest';
import { pageDragOffset, pageEntryOffset, pageSwipeOutcome } from './pageSwipe';

const both = { canPrevious: true, canNext: true };

describe('pageDragOffset', () => {
  it('follows the finger toward a page that exists', () => {
    expect(pageDragOffset(-80, both)).toBe(-80);
    expect(pageDragOffset(60, both)).toBe(60);
  });

  it('resists and caps travel past the first or last page', () => {
    expect(pageDragOffset(-100, { canPrevious: true, canNext: false })).toBeCloseTo(-22);
    expect(pageDragOffset(400, { canPrevious: false, canNext: true })).toBe(48);
    expect(pageDragOffset(0, { canPrevious: false, canNext: false })).toBe(0);
  });
});

describe('pageSwipeOutcome', () => {
  it('turns the page after a long enough drag', () => {
    expect(pageSwipeOutcome(-90, 0, 375, both)).toBe('next');
    expect(pageSwipeOutcome(90, 0, 375, both)).toBe('previous');
  });

  it('springs back from a short, slow drag', () => {
    expect(pageSwipeOutcome(-40, 0.1, 375, both)).toBe('stay');
  });

  it('turns the page for a quick flick in the same direction', () => {
    expect(pageSwipeOutcome(-30, -0.8, 375, both)).toBe('next');
    expect(pageSwipeOutcome(-30, 0.8, 375, both)).toBe('stay');
  });

  it('never turns toward a page that does not exist', () => {
    expect(pageSwipeOutcome(-200, -2, 375, { canPrevious: true, canNext: false })).toBe('stay');
    expect(pageSwipeOutcome(200, 2, 375, { canPrevious: false, canNext: true })).toBe('stay');
  });

  it('scales the commit distance with width within fixed bounds', () => {
    expect(pageSwipeOutcome(-60, 0, 240, both)).toBe('next');
    expect(pageSwipeOutcome(-90, 0, 1200, both)).toBe('stay');
    expect(pageSwipeOutcome(-96, 0, 1200, both)).toBe('next');
  });
});

describe('pageEntryOffset', () => {
  it('starts an arriving page a bounded distance off on its own side', () => {
    expect(pageEntryOffset(1, 375)).toBe(105);
    expect(pageEntryOffset(-1, 1200)).toBe(-120);
    expect(pageEntryOffset(1, 100)).toBe(48);
  });
});
