import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RepsRirControl } from './RepsRirControl';

describe('RepsRirControl', () => {
  it('renders reps input with numeric value and RIR badge', () => {
    const markup = renderToStaticMarkup(
      createElement(RepsRirControl, {
        name: 'reps-ex-1',
        label: 'Bench press set 1',
        reps: 8,
        rir: 2,
        trackRir: true,
        onChange: () => {}
      })
    );

    expect(markup).toContain('name="reps-ex-1"');
    expect(markup).toContain('aria-label="Bench press set 1 reps"');
    expect(markup).toContain('value="8"');
    expect(markup).toContain('reps-rir-badge');
    expect(markup).toContain('rir-tier-2');
    expect(markup).toContain('>2</span>');
  });

  it('renders flame placeholder when rir is null and trackRir is true', () => {
    const markup = renderToStaticMarkup(
      createElement(RepsRirControl, {
        name: 'reps-ex-2',
        label: 'Squat set 1',
        reps: 5,
        rir: null,
        trackRir: true,
        onChange: () => {}
      })
    );

    expect(markup).toContain('reps-rir-flame');
    expect(markup).toContain('aria-valuetext="5 reps, RIR unset"');
  });

  it('renders 5+ for rir equal to or greater than 5', () => {
    const markup = renderToStaticMarkup(
      createElement(RepsRirControl, {
        name: 'reps-ex-3',
        label: 'Deadlift set 1',
        reps: 10,
        rir: 5,
        trackRir: true,
        onChange: () => {}
      })
    );

    expect(markup).toContain('>5+</span>');
    expect(markup).toContain('rir-tier-easy');
    expect(markup).toContain('aria-valuetext="10 reps, 5+ RIR"');
  });

  it('omits rir badge and valuetext when trackRir is false', () => {
    const markup = renderToStaticMarkup(
      createElement(RepsRirControl, {
        name: 'reps-ex-4',
        label: 'Overhead press set 1',
        reps: 12,
        rir: 1,
        trackRir: false,
        onChange: () => {}
      })
    );

    expect(markup).not.toContain('reps-rir-badge');
    expect(markup).not.toContain('aria-valuetext');
  });
});
