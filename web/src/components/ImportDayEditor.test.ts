import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DraftSet, DraftWorkout } from '../types';
import { DayEditor } from './ImportDayEditor';

function renderEditor(overrides: { targetRpe?: number | null; repsText?: string | null; loadText?: string | null; repsSource?: DraftSet['repsSource'] } = {}) {
  const day: DraftWorkout = {
    lineId: 'day-line', week: 1, name: 'Week 1 Upper', focus: null, notes: null,
    exercises: [{
      lineId: 'exercise-line', sourceName: 'Barbell bench press', exerciseId: 'bench-id', notes: null,
      sequenceGroup: '', substitutions: [], sets: [{
        repMin: 6, repMax: 6, targetRpe: overrides.targetRpe ?? null, restSeconds: 120, tempo: null,
        loadText: overrides.loadText === undefined ? '70–75% 1RM' : overrides.loadText, notes: null, repsSource: overrides.repsSource ?? 'extracted', rpeSource: 'inferred',
        restSource: 'extracted', repsText: overrides.repsText === undefined ? '6/6' : overrides.repsText,
        restText: '2 min', rir: null, warmup: false, sourcePage: 3
      }]
    }],
    block: 'Block 1', phase: 'Base', phaseWeek: 1, isRestDay: false, sourcePage: 3
  };

  return renderToStaticMarkup(createElement(DayEditor, {
    day, exercises: [], onChange: async () => {}
  }));
}

describe('PDF import set review fields', () => {
  it('shows editable verbatim reps and source load beside the executable prescription', () => {
    const markup = renderEditor();

    expect(markup).toContain('aria-label="Source reps (verbatim) for Barbell bench press set 1"');
    expect(markup).toContain('aria-label="Source load for Barbell bench press set 1"');
    expect(markup).toContain('value="6/6"');
    expect(markup).toContain('value="70–75% 1RM"');
    expect(markup).toContain('maxLength="40"');
    expect(markup).toContain('maxLength="60"');
    expect(markup).toContain('data-import-field="repMin"');
    expect(markup).toContain('data-import-field="repMax"');
    expect(markup).toContain('class="provenance extracted"');
    expect(markup).toContain('>Extracted</span>');
  });

  it('explains percentage load without RPE as non-blocking source information', () => {
    const markup = renderEditor();

    expect(markup).toContain('role="note"');
    expect(markup).toContain('The PDF lists 70–75% 1RM as a load target but does not specify RPE.');
    expect(markup).not.toContain('aria-invalid="true"');
  });

  it('omits the percentage-only notice when RPE exists or load is not a percentage', () => {
    expect(renderEditor({ targetRpe: 8 })).not.toContain('import-set-source-load-notice');
    expect(renderEditor({ loadText: 'Bodyweight' })).not.toContain('import-set-source-load-notice');
  });

  it('does not show extracted provenance when the verbatim source text is empty', () => {
    const markup = renderEditor({ repsText: null });

    expect(markup).toContain('aria-label="Source reps (verbatim) for Barbell bench press set 1"');
    expect(markup).not.toContain('class="provenance extracted"');
  });

  it('distinguishes extracted notation, inferred bounds, and user-edited reps', () => {
    expect(renderEditor({ repsSource: 'extracted' })).toContain('>Extracted</span>');
    expect(renderEditor({ repsSource: 'inferred' })).toContain('>Bounds inferred</span>');
    expect(renderEditor({ repsSource: 'userEdited' })).toContain('>Edited</span>');
  });

  it('associates overlong source text with an accessible inline error', () => {
    const markup = renderEditor({ repsText: 'r'.repeat(41), loadText: 'l'.repeat(61) });

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('Verbatim reps must be 40 characters or fewer.');
    expect(markup).toContain('Load must be 60 characters or fewer.');
    expect(markup).toContain('role="alert"');
    expect(markup).toMatch(/aria-describedby="[^"]+-error"/);
  });

  it('matches the API percentage-load format instead of any percent substring', () => {
    for (const loadText of ['75%', '75% 1RM', '70-75% 1RM', '70–75.5% 1 rm']) {
      expect(renderEditor({ loadText })).toContain('import-set-source-load-notice');
    }
    for (const loadText of ['Bodyweight', 'Training at 75% then back off', '75% 1RM plus a drop set']) {
      expect(renderEditor({ loadText })).not.toContain('import-set-source-load-notice');
    }
  });
});
