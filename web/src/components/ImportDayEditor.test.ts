import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DraftWorkout } from '../types';
import { DayEditor } from './ImportDayEditor';

function renderEditor() {
  const day: DraftWorkout = {
    lineId: 'day-line', week: 1, name: 'Week 1 Upper', focus: null, notes: null,
    exercises: [{
      lineId: 'exercise-line', sourceName: 'Barbell bench press', exerciseId: 'bench-id', notes: null,
      sequenceGroup: '', substitutions: [], sets: [{
        repMin: 6, repMax: 6, targetRpe: null, restSeconds: 120, tempo: null,
        loadText: '70–75% 1RM', notes: null, repsSource: 'extracted', rpeSource: 'inferred',
        restSource: 'extracted', repsText: '6/6', restText: '2 min', rir: null, warmup: false, sourcePage: 3
      }]
    }],
    block: 'Block 1', phase: 'Base', phaseWeek: 1, isRestDay: false, sourcePage: 3
  };

  return renderToStaticMarkup(createElement(DayEditor, {
    day, exercises: [], onChange: async () => {}
  }));
}

describe('PDF import set review fields', () => {
  it('shows the four editable prescription fields without source-value inputs', () => {
    const markup = renderEditor();

    expect(markup).toContain('data-import-field="repMin"');
    expect(markup).toContain('data-import-field="repMax"');
    expect(markup).toContain('data-import-field="targetRpe"');
    expect(markup).toContain('data-import-field="rest"');
    expect(markup).not.toContain('Source reps (verbatim)');
    expect(markup).not.toContain('Source load');
  });
});
