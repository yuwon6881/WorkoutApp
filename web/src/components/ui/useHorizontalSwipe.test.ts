import { afterEach, describe, expect, it, vi } from 'vitest';

const refSlots: { current: unknown }[] = [];
let refCursor = 0;

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: <T>(initial: T) => {
      const index = refCursor++;
      if (!refSlots[index]) refSlots[index] = { current: initial };
      return refSlots[index] as { current: T };
    }
  };
});

import { useHorizontalSwipe } from './useHorizontalSwipe';

const surface = { contains: () => true } as unknown as HTMLElement;
const plain = { closest: () => null } as unknown as HTMLElement;
const field = { closest: (selector: string) => (selector.includes('input') ? {} : null) } as unknown as HTMLElement;

function touch(type: string, x: number, timeStamp: number, target: HTMLElement = plain) {
  return { type, pointerId: 1, pointerType: 'touch', clientX: x, clientY: 0, timeStamp, target, currentTarget: surface };
}

function click(timeStamp: number) {
  return { timeStamp, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

function mount() {
  refCursor = 0;
  return useHorizontalSwipe({ onNext: vi.fn(), onPrevious: vi.fn() });
}

afterEach(() => {
  refSlots.length = 0;
  refCursor = 0;
});

describe('useHorizontalSwipe click swallowing', () => {
  it('swallows the click a swipe ends on', () => {
    const swipe = mount();
    swipe.onPointerDown(touch('pointerdown', 200, 1000) as never);
    swipe.onPointerMove(touch('pointermove', 100, 1020) as never);
    swipe.onPointerUp(touch('pointerup', 100, 1040) as never);
    const ending = click(1050);
    swipe.onClickCapture(ending as never);
    expect(ending.preventDefault).toHaveBeenCalled();
  });

  // A swipe that ends without its click (the app is backgrounded, or the browser sends none) must
  // not leave the next, separate tap on a field swallowed: that tap starts a new gesture.
  it('lets a fresh tap on a text field through after a swipe whose click never came', () => {
    const swipe = mount();
    swipe.onPointerDown(touch('pointerdown', 200, 1000) as never);
    swipe.onPointerMove(touch('pointermove', 100, 1020) as never);
    swipe.onPointerUp(touch('pointerup', 100, 1040) as never);
    // A later tap on the reps field, inside the old window as the clock reads it.
    swipe.onPointerDown(touch('pointerdown', 150, 1100, field) as never);
    const tap = click(1120);
    swipe.onClickCapture(tap as never);
    expect(tap.preventDefault).not.toHaveBeenCalled();
    expect(tap.stopPropagation).not.toHaveBeenCalled();
  });
});
