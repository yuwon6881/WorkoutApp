import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RpeControl, RPE_STEPS } from './RpeControl';

describe('RpeControl', () => {
  it('renders value and stepper controls', () => {
    const markup = renderToStaticMarkup(
      createElement(RpeControl, {
        value: 2,
        onChange: () => {},
        ariaLabel: 'Target RIR'
      })
    );

    expect(markup).toContain('2 RIR');
    expect(markup).toContain('aria-label="Decrease RIR"');
    expect(markup).toContain('aria-label="Increase RIR"');
    expect(markup).toContain('class="rpe-control');
  });

  it('renders dash when value is null', () => {
    const markup = renderToStaticMarkup(
      createElement(RpeControl, {
        value: null,
        onChange: () => {},
        ariaLabel: 'Target RIR'
      })
    );

    expect(markup).toContain('—');
  });

  it('includes valid whole integer RIR steps from 0 to 4 without partial .5', () => {
    expect(RPE_STEPS[0]).toBe(0);
    expect(RPE_STEPS[RPE_STEPS.length - 1]).toBe(4);
    expect(RPE_STEPS).toContain(2);
    expect(RPE_STEPS).not.toContain(0.5);
    expect(RPE_STEPS).not.toContain(1.5);
  });
});
