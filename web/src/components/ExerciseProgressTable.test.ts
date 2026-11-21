import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExerciseMetricPoint } from '../types';
import { TrackRirContext } from '../lib/trackRir';
import { ExerciseProgressTable } from './ExerciseProgressTable';

const point = (n: number, over: Partial<ExerciseMetricPoint> = {}): ExerciseMetricPoint => ({
  date: `2026-10-${String(n).padStart(2, '0')}`, sessionId: `s${n}`, sessionName: `Session ${n}`,
  estimated1RmKg: null, loadKg: null, volumeKg: null, reps: null, partial: false, ...over
});
const kg = (value: number | null | undefined) => value == null ? '—' : `${value} kg`;
const render = (points: ExerciseMetricPoint[]) => renderToStaticMarkup(createElement(ExerciseProgressTable, {
  points, formatDate: value => value, formatEstimate: kg, formatLoad: kg, formatVolume: kg
}));

describe('ExerciseProgressTable', () => {
  it('leaves out columns no session has a value for', () => {
    const markup = render([point(1, { reps: 8, partial: true })]);
    expect(markup).toContain('>Reps<');
    expect(markup).not.toContain('>1RM<');
    expect(markup).not.toContain('>Load<');
    expect(markup).not.toContain('>Volume<');
  });

  it('lists the newest session first and folds long histories', () => {
    const points = Array.from({ length: 9 }, (_, i) => point(i + 1, { loadKg: 20 + i, reps: 5 }));
    const markup = render(points);
    expect(markup.indexOf('2026-10-09')).toBeLessThan(markup.indexOf('2026-10-07'));
    expect(markup).not.toContain('2026-10-01');
    expect(markup).toContain('Show all 9 sessions');
  });

  it('shows no fold control when everything fits', () => {
    expect(render([point(1, { loadKg: 20 }), point(2, { loadKg: 22.5 })])).not.toContain('Show all');
  });

  it('shows the reserve behind each row, so equal loads and reps with different estimates explain themselves', () => {
    const markup = render([
      point(1, { estimated1RmKg: 120, loadKg: 100, reps: 5, rir: '3' }),
      point(2, { estimated1RmKg: 125, loadKg: 100, reps: 5, rir: '1' })
    ]);
    expect(markup).toContain('data-label="RIR">3<');
    expect(markup).toContain('data-label="RIR">1<');
  });

  it('leaves the RIR column out when no row has one or tracking is off', () => {
    expect(render([point(1, { loadKg: 100, reps: 5 })])).not.toContain('>RIR<');
    const off = renderToStaticMarkup(createElement(TrackRirContext.Provider, { value: false },
      createElement(ExerciseProgressTable, { points: [point(1, { loadKg: 100, reps: 5, rir: '1' })],
        formatDate: value => value, formatEstimate: kg, formatLoad: kg, formatVolume: kg })));
    expect(off).not.toContain('>RIR<');
  });

  it('associates each displayed value with its heading and omits the verbose estimate note', () => {
    const markup = render([point(1, { estimated1RmKg: 120, loadKg: 100, volumeKg: 800, reps: 8, partial: true })]);
    expect(markup).toContain('data-label="Date"');
    expect(markup).toContain('data-label="1RM"');
    expect(markup).toContain('data-label="Load"');
    expect(markup).toContain('data-label="Volume"');
    expect(markup).toContain('800 kg\u00a0*');
    expect(markup).toContain('data-label="Reps"');
    expect(markup).not.toContain('Estimated 1RM needs the reps in reserve');
  });

  it('folds large histories (e.g. 2000 sessions) smoothly without rendering thousands of DOM rows', () => {
    const points = Array.from({ length: 2000 }, (_, i) => point(i + 1, { loadKg: 20 + (i % 50), reps: 5 }));
    const markup = render(points);
    expect(markup).toContain('2000 sessions');
    expect(markup).toContain('Show all 2000 sessions');
    // Displays the newest session
    expect(markup).toContain('2026-10-2000');
    // Does not render early sessions in folded view
    expect(markup).not.toContain('2026-10-01<');
  });
});
