import { describe, expect, it } from 'vitest';
import { readHorizontalOverflow } from './useHorizontalOverflow';

describe('readHorizontalOverflow', () => {
  it('reports nothing when the content fits', () => {
    expect(readHorizontalOverflow({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({ start: false, end: false });
    expect(readHorizontalOverflow({ scrollLeft: 0, scrollWidth: 301, clientWidth: 300 })).toEqual({ start: false, end: false });
  });

  it('reports the hidden edges as the row scrolls', () => {
    expect(readHorizontalOverflow({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 })).toEqual({ start: false, end: true });
    expect(readHorizontalOverflow({ scrollLeft: 150, scrollWidth: 600, clientWidth: 300 })).toEqual({ start: true, end: true });
    expect(readHorizontalOverflow({ scrollLeft: 299.5, scrollWidth: 600, clientWidth: 300 })).toEqual({ start: true, end: false });
  });
});
