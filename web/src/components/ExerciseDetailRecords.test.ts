import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExerciseInsight } from '../types';
import { ProgressPanel } from './ExerciseDetailModal';

const insight: ExerciseInsight = {
  id: 'squat', name: 'Squat', muscle: 'Quads', equipment: 'Barbell', loadModel: 'external',
  loadStepKg: 2.5, isCustom: false, archived: false, sessions: 1, setCount: 3, clearableSetCount: 3,
  estimated1RmKg: 120, estimated1RmDate: '2026-10-27', heaviestKg: 100, heaviestReps: 8,
  heaviestDate: '2026-10-27', largestSetVolumeKg: 800, largestSetVolumeDate: '2026-10-27',
  largestSessionVolumeKg: 2400, largestSessionVolumeDate: '2026-10-27', repPr: 10,
  repPrDate: '2026-10-27', lastPerformedDate: '2026-10-27', partialVolume: false,
  points: [], history: [], page: 0, size: 20, totalHistoryRows: 1, externalLoadPrKg: 100
};

function render(overrides: Partial<ExerciseInsight> = {}) {
  return renderToStaticMarkup(createElement(ProgressPanel, {
    insight: { ...insight, ...overrides }, unit: 'kg', basis: { weightBasis: 'total' }, range: '3m', onRange: () => {}
  }));
}

describe('exercise detail records', () => {
  it('does not repeat an identical external load record or leave an empty section', () => {
    const markup = render();
    expect(markup).toContain('Heaviest load');
    expect(markup).not.toContain('External load PR');
    expect(markup).not.toContain('Resistance records');
    expect(markup.match(/class="stat-card"/g)).toHaveLength(7);
    expect(render({ heaviestKg: 0, externalLoadPrKg: 0 })).not.toContain('External load PR');
  });

  it('keeps distinct and mixed resistance records, including unrounded differences and zero', () => {
    expect(render({ externalLoadPrKg: 100.01 })).toContain('External load PR');
    expect(render({ heaviestKg: null })).toContain('External load PR');
    expect(render({ loadModel: 'full_bodyweight' })).toContain('External load PR');
    const mixed = render({ addedLoadPrKg: 0, assistanceReductionPrKg: 15, systemLoadPrKg: 100 });
    expect(mixed).toContain('External load PR');
    expect(mixed).toContain('Added load PR');
    expect(mixed).toContain('Lowest assistance');
    expect(mixed).toContain('System load PR');
  });
});