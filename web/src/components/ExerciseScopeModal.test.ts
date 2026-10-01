import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExerciseScopeModal } from './ExerciseScopeModal';

const render = (counts: { block: number; program: number }) => renderToStaticMarkup(createElement(ExerciseScopeModal, {
  exerciseName: 'Bench Press', changes: ['rest timer', 'notes'], counts, busy: false, error: null,
  onConfirm: () => {}, onCancel: () => {}
}));

const checkedValue = (markup: string) => markup.match(/value="(\w+)"[^>]*checked/)?.[1]
  ?? markup.match(/checked=""[^>]*value="(\w+)"/)?.[1];

describe('ExerciseScopeModal', () => {
  it('defaults to the same block and counts the occurrences each wider choice reaches', () => {
    const markup = render({ block: 3, program: 7 });

    expect(checkedValue(markup)).toBe('block');
    expect(markup).toContain('3 other occurrences');
    expect(markup).toContain('7 other occurrences');
    expect(markup).toContain('This occurrence only');
    expect(markup).toContain('rest timer, notes');
  });

  it('offers only the choices that would change something', () => {
    const programOnly = render({ block: 0, program: 2 });
    expect(checkedValue(programOnly)).toBe('occurrence');
    expect(programOnly).not.toContain('Same block');
    expect(programOnly).toContain('Whole program');

    const blockIsProgram = render({ block: 2, program: 2 });
    expect(blockIsProgram).toContain('Same block');
    expect(blockIsProgram).not.toContain('Whole program');
    expect(blockIsProgram).toContain('2 other occurrences');
  });

  it('uses the singular for a single other occurrence', () => {
    expect(render({ block: 1, program: 1 })).toContain('1 other occurrence<');
  });
});
