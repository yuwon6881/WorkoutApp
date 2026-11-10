import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { viewReadCache } from '../lib/viewReadCache';
import { ViewReadScopeContext } from '../lib/viewReadScope';
import type { ExerciseLastPerformed } from '../lib/lastPerformed';
import { NextWorkoutPlan } from './NextWorkoutPlan';
import { mockBootstrap, mockTemplate } from './nextWorkoutHeroTestFixtures';

afterEach(() => {
  viewReadCache.reset();
  vi.restoreAllMocks();
});

describe('NextWorkoutPlan view cache sharing', () => {
  it('reuses cached last-performed metadata and cached template within the same scope', () => {
    const scope = JSON.stringify(['acc-1', { templates: 1, history: 1 }]);
    const template = mockTemplate({ id: 'tpl-1' });
    const lastRows: ExerciseLastPerformed[] = [{
      exerciseId: 'bench', weightKg: 100, reps: 8, durationSeconds: null, finishedAt: '2026-10-27T12:00:00Z'
    }];
    viewReadCache.set(`${scope}:template:tpl-1`, 1, template);
    viewReadCache.set(`${scope}:last-performed`, 1, lastRows);

    const html = renderToStaticMarkup(createElement(
      ViewReadScopeContext,
      { value: scope },
      createElement(NextWorkoutPlan, { data: mockBootstrap(), templateId: 'tpl-1' })
    ));

    expect(html).toContain('Bench Press');
    expect(html).toContain('100 kg');
    expect(html).not.toContain('hero-plan-skeleton');
  });

  it('keeps the plan skeleton reserved while launch confirmation is pending', () => {
    const templateSpy = vi.spyOn(api, 'getTemplate');
    const lastSpy = vi.spyOn(api, 'lastPerformed');
    const scope = JSON.stringify(['acc-1', { templates: 1, history: 1 }]);
    viewReadCache.set(`${scope}:template:tpl-1`, 1, mockTemplate({ id: 'tpl-1' }));
    viewReadCache.set(`${scope}:last-performed`, 1, [{
      exerciseId: 'bench', weightKg: 100, reps: 8, durationSeconds: null, finishedAt: '2026-10-27T12:00:00Z'
    }]);

    const html = renderToStaticMarkup(createElement(
      ViewReadScopeContext,
      { value: scope },
      createElement(NextWorkoutPlan, { data: mockBootstrap({ templates: [] }), templateId: 'tpl-1', unconfirmed: true })
    ));

    expect(html).toContain('hero-plan-skeleton');
    expect(html).not.toContain('Bench Press');
    expect(templateSpy).not.toHaveBeenCalled();
    expect(lastSpy).not.toHaveBeenCalled();
  });

  it('invalidates cached plan reads when the account or resource version scope changes', () => {
    const oldScope = JSON.stringify(['acc-1', { templates: 1, history: 1 }]);
    const nextScope = JSON.stringify(['acc-1', { templates: 1, history: 2 }]);
    viewReadCache.set(`${oldScope}:template:tpl-1`, 1, mockTemplate({ id: 'tpl-1' }));
    viewReadCache.set(`${oldScope}:last-performed`, 1, [{
      exerciseId: 'bench', weightKg: 100, reps: 8, durationSeconds: null, finishedAt: '2026-10-27T12:00:00Z'
    }]);

    const html = renderToStaticMarkup(createElement(
      ViewReadScopeContext,
      { value: nextScope },
      createElement(NextWorkoutPlan, { data: mockBootstrap(), templateId: 'tpl-1' })
    ));

    expect(html).toContain('hero-plan-skeleton');
    expect(html).not.toContain('Bench Press');
  });
});
