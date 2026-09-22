import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RpeControl, RPE_STEPS } from './RpeControl';

describe('RpeControl', () => {
  it('renders value and stepper controls', () => {
    const markup = renderToStaticMarkup(
      createElement(RpeControl, {
        value: 8.5,
        onChange: () => {},
        ariaLabel: 'Target RPE'
      })
    );

    expect(markup).toContain('8.5');
    expect(markup).toContain('aria-label="Decrease RPE"');
    expect(markup).toContain('aria-label="Increase RPE"');
    expect(markup).toContain('class="rpe-control');
  });

  it('renders dash when value is null', () => {
    const markup = renderToStaticMarkup(
      createElement(RpeControl, {
        value: null,
        onChange: () => {},
        ariaLabel: 'Target RPE'
      })
    );

    expect(markup).toContain('—');
  });

  it('includes valid RPE steps from 6 to 10', () => {
    expect(RPE_STEPS[0]).toBe(6);
    expect(RPE_STEPS[RPE_STEPS.length - 1]).toBe(10);
    expect(RPE_STEPS).toContain(8);
    expect(RPE_STEPS).toContain(8.5);
  });
});
