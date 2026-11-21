import { afterEach, describe, expect, it, vi } from 'vitest';
import { healPageReachability, pageIsUnreachable } from './pageReachability';

function fakePage(rect: Partial<DOMRect>, scroller: object | null = {}) {
  const style = { willChange: '' };
  return {
    element: {
      parentElement: scroller,
      getBoundingClientRect: () => ({ left: 10, top: 100, right: 410, bottom: 700, width: 400, height: 600, ...rect }),
      offsetHeight: 600,
      style,
      dataset: {} as Record<string, string>
    } as unknown as HTMLElement,
    style
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('pageIsUnreachable', () => {
  it('flags a page whose centre hits its own scroller', () => {
    vi.stubGlobal('window', { innerHeight: 800 });
    const scroller = {};
    const { element } = fakePage({}, scroller);
    expect(pageIsUnreachable(element, () => scroller as Element)).toBe(true);
  });

  it('leaves a page alone when something else, or the page itself, is hit', () => {
    vi.stubGlobal('window', { innerHeight: 800 });
    const { element } = fakePage({});
    expect(pageIsUnreachable(element, () => ({}) as Element)).toBe(false);
    expect(pageIsUnreachable(element, () => null)).toBe(false);
  });

  it('ignores a page with no visible area', () => {
    vi.stubGlobal('window', { innerHeight: 800 });
    const { element } = fakePage({ top: 900, bottom: 1500, height: 600 });
    expect(pageIsUnreachable(element, () => element.parentElement as Element)).toBe(false);
  });
});

describe('healPageReachability', () => {
  it('does nothing without a page', () => {
    expect(healPageReachability(null)).toBe(false);
  });
});
