import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoadRuleEditor } from './LoadRuleEditor';

const base = {
  unit: 'kg' as const, name: 'test', rule: { loadStepKg: null, availableLoadsKg: null },
  busy: false, onSubmit: () => {}, onCancel: () => {}
};

describe('inherited weight rules', () => {
  it('shows reps-only when that is the inherited setting', () => {
    const html = renderToStaticMarkup(createElement(LoadRuleEditor, { ...base, inheritedStepKg: 0 }));
    expect(html).toContain('Keep the same weight and progress by reps.');
    expect(html).not.toContain('Weight increase (kg)');
  });
  it('opens the inherited available weights with their selections', () => {
    const html = renderToStaticMarkup(createElement(LoadRuleEditor, { ...base, inheritedStepKg: 2.5, inheritedLoadsKg: [5, 12.5] }));
    expect(html).toContain('5 kg, 12.5 kg');
  });
});
