import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImportDraft, ImportView } from '../types';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { ImportReviewPanel } from './ImportReviewPanel';

describe('import gym review', () => {
  it('lists each unavailable movement group once and identifies the gym', () => {
    const movement = (lineId: string, sourceName: string) => ({ lineId, sourceName, exerciseId: 'squat', sets: [] });
    const draft = { programName: 'Plan', workouts: [
      { lineId: 'day1', exercises: [movement('one', 'Squat'), movement('two', 'Squat')] },
      { lineId: 'day2', exercises: [movement('three', 'Paused squat')] }
    ] } as unknown as ImportDraft;
    const view = { unresolved: [], acceptable: true } as unknown as ImportView;
    const html = renderToStaticMarkup(createElement(GymAvailabilityContext.Provider, {
      value: { gym: { active: { id: 'gym', name: 'Lalaport', active: true, revision: 1,
        missingEquipment: ['rack'], exerciseOverrides: {} }, profiles: [{ id: 'gym', name: 'Lalaport' }],
        missingLabels: { rack: 'Rack' } }, requires: new Map([['squat', ['rack']]]) }
    }, createElement(ImportReviewPanel, { view, draft, attentionRows: [], onNameChange: () => {},
      onNameCommit: () => {}, onFocusIssue: () => {} })));
    expect(html).toContain('2 movements are unavailable');
    expect(html).toContain('<strong>Lalaport</strong>');
    expect(html).toContain('Replace Squat');
    expect(html).toContain('Replace Paused squat');
    expect(html).toContain('Missing: Rack');
  });
});
