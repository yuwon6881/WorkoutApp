import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChipScroller, chipScrollerNavClass } from './ChipScroller';

describe('ChipScroller', () => {
  it('adds directional scroll edge classes only where hidden chips exist', () => {
    expect(chipScrollerNavClass(false, false)).toBe('filter-chips-nav');
    expect(chipScrollerNavClass(true, false)).toBe('filter-chips-nav has-overflow can-scroll-left');
    expect(chipScrollerNavClass(false, true)).toBe('filter-chips-nav has-overflow can-scroll-right');
    expect(chipScrollerNavClass(true, true)).toBe('filter-chips-nav has-overflow can-scroll-left can-scroll-right');
  });

  it('renders accessible scroll controls around the chip group', () => {
    const markup = renderToStaticMarkup(createElement(
      ChipScroller,
      {
        ariaLabel: 'Filter exercises by muscle',
        leftLabel: 'Left',
        rightLabel: 'Right',
        children: createElement('span', null, 'All muscles'),
      }
    ));
    expect(markup).toContain('aria-label="Filter exercises by muscle"');
    expect(markup).toContain('aria-label="Left"');
    expect(markup).toContain('aria-label="Right"');
  });
});
