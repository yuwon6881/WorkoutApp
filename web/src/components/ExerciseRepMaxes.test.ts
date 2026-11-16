import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RepMaxRecord } from '../types';
import { TrackRirContext } from '../lib/trackRir';
import { ExerciseRepMaxes } from './ExerciseRepMaxes';

const record = (reps: number, loadKg: number, over: Partial<RepMaxRecord> = {}): RepMaxRecord =>
  ({ reps, loadKg, actualReps: reps, rir: '1', date: '2026-10-05', ...over });
const kg = (value: number | null | undefined) => value == null ? '—' : `${value} kg`;
const render = (repMaxes: RepMaxRecord[], trackRir = true) => renderToStaticMarkup(
  createElement(TrackRirContext.Provider, { value: trackRir },
    createElement(ExerciseRepMaxes, { repMaxes, formatDate: value => value, formatLoad: kg })));

describe('ExerciseRepMaxes', () => {
  it('renders nothing when no set qualifies', () => {
    expect(render([])).toBe('');
  });

  it('lists each rep max with the reps and reserve of the set behind it', () => {
    const markup = render([record(1, 140, { rir: '0' }), record(5, 110, { actualReps: 6 })]);
    expect(markup).toContain('1 rep<');
    expect(markup).toContain('5 reps<');
    expect(markup).toContain('110 kg');
    expect(markup).toContain('data-label="Done">6<');
    expect(markup).toContain('data-label="RIR">0<');
    expect(markup).toContain('within 2 reps of failure');
  });

  it('leaves reserve out entirely when RIR tracking is off', () => {
    const markup = render([record(5, 110)], false);
    expect(markup).not.toContain('RIR');
    expect(markup).not.toContain('within 2 reps');
    expect(markup).toContain('110 kg');
  });
});
