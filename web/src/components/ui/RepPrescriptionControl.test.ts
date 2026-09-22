import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RepPrescriptionControl } from './RepPrescriptionControl';

describe('RepPrescriptionControl', () => {
  it('renders range mode with min and max inputs when repMin and repMax differ', () => {
    const markup = renderToStaticMarkup(
      createElement(RepPrescriptionControl, {
        repMin: 8,
        repMax: 12,
        nameMin: 'rep-min-test',
        nameMax: 'rep-max-test',
        nameSingle: 'rep-single-test',
        dataImportIndex: 0,
        onChange: () => {}
      })
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

  it('renders single rep mode with one visible input when repMin and repMax are equal', () => {
    const markup = renderToStaticMarkup(
      createElement(RepPrescriptionControl, {
        repMin: 10,
        repMax: 10,
        nameMin: 'rep-min-test',
        nameMax: 'rep-max-test',
        nameSingle: 'rep-single-test',
        dataImportIndex: 1,
        onChange: () => {}
      })
    );

    expect(markup).toContain('Reps');
    expect(markup).toContain('aria-label="Reps"');
    expect(markup).toContain('value="10"');
    expect(markup).toContain('data-import-field="repMin"');
    // Hidden input preserves data-import-field="repMax" for forms and SSR validation
    expect(markup).toContain('type="hidden"');
    expect(markup).toContain('data-import-field="repMax"');
    expect(markup).not.toContain('aria-label="Min reps"');
    expect(markup).not.toContain('aria-label="Max reps"');
  });

  it('provides accessible toggle buttons for Rep and Range modes', () => {
    const rangeMarkup = renderToStaticMarkup(
      createElement(RepPrescriptionControl, {
        repMin: 6,
        repMax: 8,
        nameMin: 'rep-min-test',
        nameMax: 'rep-max-test',
        nameSingle: 'rep-single-test',
        onChange: () => {}
      })
    );

    expect(rangeMarkup).toContain('aria-label="Rep prescription mode"');
    expect(rangeMarkup).toContain('aria-pressed="false">Rep</button>');
    expect(rangeMarkup).toContain('aria-pressed="true">Range</button>');

    const singleMarkup = renderToStaticMarkup(
      createElement(RepPrescriptionControl, {
        repMin: 5,
        repMax: 5,
        nameMin: 'rep-min-test',
        nameMax: 'rep-max-test',
        nameSingle: 'rep-single-test',
        onChange: () => {}
      })
    );

    expect(singleMarkup).toContain('aria-pressed="true">Rep</button>');
    expect(singleMarkup).toContain('aria-pressed="false">Range</button>');
  });
});
