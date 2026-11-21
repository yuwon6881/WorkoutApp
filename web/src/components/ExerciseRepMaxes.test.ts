import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExerciseRepMaxes, repMaxLoadKg } from './ExerciseRepMaxes';

const kg = (value: number) => `${Number(value.toFixed(1))} kg`;
const render = (estimated: number | null | undefined) =>
  renderToStaticMarkup(createElement(ExerciseRepMaxes, { estimated1RmKg: estimated, formatEstimate: kg }));

describe('repMaxLoadKg', () => {
  it('keeps a single at the max and lowers heavier rep counts by Epley', () => {
    expect(repMaxLoadKg(100, 1)).toBe(100);
    expect(repMaxLoadKg(100, 3)).toBeCloseTo(90.909, 2);
    expect(repMaxLoadKg(100, 5)).toBeCloseTo(85.714, 2);
    expect(repMaxLoadKg(100, 10)).toBeCloseTo(75, 5);
  });
});

describe('ExerciseRepMaxes', () => {
  it('renders nothing without a 1RM estimate', () => {
    expect(render(null)).toBe('');
    expect(render(undefined)).toBe('');
  });

  it('lists every rep max with its share of the 1RM, not past sets', () => {
    const markup = render(100);
    for (const label of ['1 rep<', '3 reps<', '5 reps<', '8 reps<', '10 reps<']) expect(markup).toContain(label);
    expect(markup).toContain('90.9 kg');
    expect(markup).toContain('85.7 kg');
    expect(markup).toContain('91% of 1RM');
    expect(markup).toContain('estimated 1RM of 100 kg');
  });
});
