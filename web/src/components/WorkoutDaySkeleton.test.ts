import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkoutDaySkeleton } from './WorkoutDaySkeleton';

describe('WorkoutDaySkeleton', () => {
  const html = renderToStaticMarkup(React.createElement(WorkoutDaySkeleton, { label: 'Loading workout details…' }));

  it('is one busy status region that names what is loading', () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('<span class="sr-only">Loading workout details…</span>');
  });

  it('draws muscle tiles and exercise cards with set lines from the real classes', () => {
    expect(html.match(/program-muscle-tile/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html.match(/readonly-exercise workout-day-skeleton-card/g)).toHaveLength(3);
    expect(html).toContain('readonly-exercise-head');
    expect(html).toContain('workout-day-skeleton-set');
  });

  it('hides the shapes from assistive technology and has no interactive controls', () => {
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html).not.toContain('<button');
  });
});
