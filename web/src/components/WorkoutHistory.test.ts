import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { viewReadCache } from '../lib/viewReadCache';
import type { HistorySummaryPage, Session } from '../types';
import { WorkoutHistory } from './WorkoutHistory';

afterEach(() => {
  viewReadCache.reset();
});

describe('WorkoutHistory unconfirmed state', () => {
  it('keeps the loading skeleton visible and ignores cached snapshots while launch is unconfirmed', () => {
    const cached: HistorySummaryPage = {
      total: 1,
      nextBeforeAt: null,
      nextBeforeId: null,
      summaryOnly: true,
      sessions: [{
        id: 's-1', name: 'Upper A', revision: 1, active: false,
        startedAt: '2026-10-27T10:00:00Z', finishedAt: '2026-10-27T11:00:00Z',
        pausedAt: null, pausedMilliseconds: 0, note: '', exercises: [], rest: null,
        volumeKg: 1000, systemVolumeKg: 1000, completedSets: 6, prCount: 0
      } as unknown as Session]
    };
    viewReadCache.set('acc-1:history', 'h:1', cached);

    const html = renderToStaticMarkup(createElement(WorkoutHistory, {
      accountId: 'acc-1',
      refreshKey: 'h:1',
      unconfirmed: true,
      unit: 'kg',
      onSession: () => {},
      onStart: () => {},
      recent: { count: 3, onShowAll: () => {} }
    }));

    expect(html).toContain('history-loading-list');
    expect(html).not.toContain('Upper A');
    expect(html).not.toContain('All history');
  });
});
