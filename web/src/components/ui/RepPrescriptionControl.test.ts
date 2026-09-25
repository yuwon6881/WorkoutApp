import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RepModeToggle, RepPrescriptionControl } from './RepPrescriptionControl';

const names = { nameMin: 'rep-min-test', nameMax: 'rep-max-test', nameSingle: 'rep-single-test' };

describe('RepPrescriptionControl', () => {
  it('renders min and max inputs in range mode', () => {
    const markup = renderToStaticMarkup(
      createElement(RepPrescriptionControl, { ...names, repMin: 8, repMax: 12, range: true, dataImportIndex: 0, onChange: () => {} })
    );

    expect(markup).toContain('Rep range');
    expect(markup).toContain('aria-label="Min reps"');
    expect(markup).toContain('value="8"');
    expect(markup).toContain('aria-label="Max reps"');
    expect(markup).toContain('value="12"');
    expect(markup).toContain('data-import-field="repMin"');
    expect(markup).toContain('data-import-field="repMax"');
    expect(markup).toContain('–');
  });

  it('renders one visible input in exact mode and keeps the max for forms', () => {
    const markup = renderToStaticMarkup(
      createElement(RepPrescriptionControl, { ...names, repMin: 10, repMax: 10, range: false, dataImportIndex: 1, onChange: () => {} })
    );

    expect(markup).toContain('aria-label="Reps"');
    expect(markup).toContain('value="10"');
    expect(markup).toContain('type="hidden"');
    expect(markup).toContain('data-import-field="repMax"');
    expect(markup).not.toContain('aria-label="Min reps"');
  });

  it('names each input after its set when a prefix is given', () => {
    const markup = renderToStaticMarkup(
      createElement(RepPrescriptionControl, { ...names, repMin: 8, repMax: 12, range: true, labelPrefix: 'Squat set 2', onChange: () => {} })
    );

    expect(markup).toContain('aria-label="Squat set 2 min reps"');
    expect(markup).toContain('aria-label="Squat set 2 max reps"');
  });

  it('shows AMRAP instead of a placeholder count when the source printed none', () => {
    const markup = renderToStaticMarkup(
      createElement(RepPrescriptionControl, { ...names, repMin: 1, repMax: 1, range: false, openReps: true, onChange: () => {} })
    );

    expect(markup).toContain('AMRAP');
    expect(markup).not.toContain('value="1"');
  });
});

describe('RepModeToggle', () => {
  it('marks the active mode as pressed under an accessible group name', () => {
    const range = renderToStaticMarkup(createElement(RepModeToggle, { range: true, label: 'Rep target for Squat', onChange: () => {} }));
    expect(range).toContain('aria-label="Rep target for Squat"');
    expect(range).toContain('aria-pressed="false">Exact</button>');
    expect(range).toContain('aria-pressed="true">Range</button>');

    const exact = renderToStaticMarkup(createElement(RepModeToggle, { range: false, label: 'Rep target for Squat', onChange: () => {} }));
    expect(exact).toContain('aria-pressed="true">Exact</button>');
  });
});
