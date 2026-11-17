import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarCardSkeleton } from './CalendarCardSkeleton';
import { OverviewLoadingContent } from './OverviewLoadingContent';

// The real card's classes come from a stylesheet that loads lazily. When it lands while a placeholder
// is on screen it restyles any element that shares a class (`.calendar-days-grid { flex: 0 0 100% }`
// once stretched the day strip over the whole card and clipped the totals), which showed as a broken
// frame on some reloads. A placeholder must never borrow those names.
const FEATURE_CLASSES = [
  'training-calendar-card',
  'calendar-days-grid',
  'calendar-day-cell',
  'calendar-week-row',
  'calendar-week-rail',
  'calendar-card-header',
  'calendar-card-footer',
  'stats-grid',
  'progress-stats',
  'progress-stat-card'
];

function classesIn(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].flatMap(match => match[1].split(/\s+/));
}

describe('CalendarCardSkeleton', () => {
  const html = renderToStaticMarkup(React.createElement(CalendarCardSkeleton));

  it('draws the week, the three totals and the legend line', () => {
    expect(html.match(/cal-sk-day/g)).toHaveLength(7);
    expect(html.match(/skeleton-stat/g)).toHaveLength(3);
    expect(html).toContain('cal-sk-legend');
  });

  it('borrows no class from the lazily loaded calendar styles', () => {
    const used = new Set(classesIn(html));
    expect(FEATURE_CLASSES.filter(name => used.has(name))).toEqual([]);
  });

  it('is hidden from assistive technology unless it is given a label', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="status"');
    const labelled = renderToStaticMarkup(React.createElement(CalendarCardSkeleton, { label: 'Loading training overview' }));
    expect(labelled).toContain('role="status"');
    expect(labelled).toContain('aria-label="Loading training overview"');
  });

  it('is the one calendar placeholder the Overview shell draws', () => {
    const overview = renderToStaticMarkup(React.createElement(OverviewLoadingContent));
    expect(overview.match(/calendar-skeleton/g)).toHaveLength(1);
    expect(FEATURE_CLASSES.filter(name => classesIn(overview).includes(name))).toEqual([]);
  });
});
