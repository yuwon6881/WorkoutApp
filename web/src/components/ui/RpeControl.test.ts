import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RIR_OPTIONS, RIR_STEPS, RpeControl, RPE_STEPS } from './RpeControl';

describe('RpeControl', () => {
  it('renders value in compact trigger without stepper buttons', () => {
    const markup = renderToStaticMarkup(
      createElement(RpeControl, {
        value: 2,
        onChange: () => {},
        ariaLabel: 'Target RIR'
      })
    );

    expect(markup).toContain('2');
    expect(markup).toContain('aria-label="2 RIR"');
    expect(markup).not.toContain('aria-label="Decrease RIR"');
    expect(markup).not.toContain('aria-label="Increase RIR"');
    expect(markup).toContain('class="rpe-control has-value"');
  });

  it('renders 5+ when value is 5 or higher', () => {
    const markup = renderToStaticMarkup(
      createElement(RpeControl, {
        value: 5,
        onChange: () => {},
        ariaLabel: 'Target RIR'
      })
    );

    expect(markup).toContain('5+');
    expect(markup).toContain('aria-label="5+ RIR"');
  });

  it('renders effort icon when value is null', () => {
    const markup = renderToStaticMarkup(
      createElement(RpeControl, {
        value: null,
        onChange: () => {},
        ariaLabel: 'Target RIR'
      })
    );

    expect(markup).toContain('rpe-effort-icon');
    expect(markup).toContain('class="rpe-control is-empty"');
  });

  it('includes valid whole integer RIR steps from 0 to 4 and 5+ option', () => {
    expect(RPE_STEPS[0]).toBe(0);
    expect(RPE_STEPS[RPE_STEPS.length - 1]).toBe(4);
    expect(RPE_STEPS).toContain(2);
    expect(RPE_STEPS).not.toContain(0.5);
    expect(RPE_STEPS).not.toContain(1.5);
    expect(RIR_STEPS).toEqual(RPE_STEPS);

    const optionValues = RIR_OPTIONS.map(opt => opt.value);
    expect(optionValues).toEqual([0, 1, 2, 3, 4, 5]);
    expect(RIR_OPTIONS.find(opt => opt.value === 5)?.label).toBe('5+ RIR');
  });
});
