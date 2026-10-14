import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExerciseMetricPoint } from '../types';
import { ExerciseProgressTable } from './ExerciseProgressTable';

const point = (n: number, over: Partial<ExerciseMetricPoint> = {}): ExerciseMetricPoint => ({
  date: `2026-10-${String(n).padStart(2, '0')}`, sessionId: `s${n}`, sessionName: `Session ${n}`,
  estimated1RmKg: null, loadKg: null, volumeKg: null, reps: null, partial: false, ...over
});
const render = (points: ExerciseMetricPoint[]) => renderToStaticMarkup(createElement(ExerciseProgressTable, {
  points, formatDate: value => value, formatKg: value => value == null ? '—' : `${value} kg`
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
});
