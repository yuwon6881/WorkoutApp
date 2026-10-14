import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { programEditLocks } from '../lib/programEditLocks';
import { activeProgram, baseDraft } from '../lib/programEditFixtures';
import { DraftOutline } from './ImportDraftTree';

const noop = async () => {};

function render(currentWeek: number, passed: Parameters<typeof activeProgram>[1] = {}, openDayId: string | null = null) {
  const locks = programEditLocks(activeProgram(currentWeek, passed), openDayId);
  return renderToStaticMarkup(createElement(DraftOutline, {
    draft: baseDraft(), expandedDay: null, setExpandedDay: () => {}, exercises: [], onDayChange: noop, onDraftChange: noop,
    editorMode: 'custom', actionLabel: 'Save changes', locks
  }));
}

describe('DraftOutline over an activated program', () => {
  it('shows nothing locked when no lock is supplied', () => {
    const markup = renderToStaticMarkup(createElement(DraftOutline, {
      draft: baseDraft(), expandedDay: null, setExpandedDay: () => {}, exercises: [], onDayChange: noop, onDraftChange: noop, editorMode: 'custom'
    }));
    expect(markup).not.toContain('pdl-lock-tag');
    expect(markup).not.toContain('has passed days');
    expect(markup).toContain('aria-label="Add workout day"');
    expect(markup).toContain('Reorder W1A');
    expect(markup).toContain('Delete week 1');
  });

  it('marks passed days, hides their handles and menus, and keeps pending days movable', () => {
    const markup = render(1, { w1a: 'completed' });
    expect(markup).toContain('pdl-lock-tag');
    expect(markup).toContain('Done');
    expect(markup).not.toContain('Reorder W1A');
    expect(markup).not.toContain('Actions for W1A');
    expect(markup).toContain('Reorder W1B');
    expect(markup).toContain('Actions for W1B');
    expect(markup).toContain('aria-label="Add workout day"');
  });

  it('seals the week list of an earlier week: no handles, no menus, no add-day actions', () => {
    const markup = render(2);
    // Week one is shown first and is wholly past.
    expect(markup).not.toContain('Reorder W1A');
    expect(markup).not.toContain('Reorder W1B');
    expect(markup).not.toContain('Actions for W1B');
    expect(markup).not.toContain('aria-label="Add workout day"');
    expect(markup).not.toContain('aria-label="Add rest day"');
    expect(markup.match(/pdl-lock-tag/g)?.length).toBe(3);
  });

  it('marks week chips that hold passed days and leaves future weeks plain', () => {
    const markup = render(2, { w2a: 'completed' });
    expect(markup.match(/\(has passed days\)/g)?.length).toBe(2);
    expect(markup).toContain('Week 3');
  });

  it('labels a skipped day and a passed rest day', () => {
    const markup = render(1, { w1a: 'skipped', w1r: 'rest_passed' });
    expect(markup).toContain('Skipped');
    expect(markup).toContain('Rest done');
  });

  it('removes the delete action from the week that holds history', () => {
    expect(render(2, { w2a: 'completed' })).not.toContain('Delete week');
  });
});
