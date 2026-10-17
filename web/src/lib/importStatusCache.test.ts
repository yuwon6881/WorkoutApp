import { describe, expect, it } from 'vitest';
import { clearRecordedImport, getRecordedHighestPercent, getRecordedImportStatus, recordImportStatus } from './importStatusCache';
import type { ImportStatusView } from '../types';

describe('importStatusCache', () => {
  it('stores and retrieves import status and maintains monotonic highest percent', () => {
    clearRecordedImport('imp-1');
    expect(getRecordedImportStatus('imp-1')).toBeUndefined();
    expect(getRecordedHighestPercent('imp-1')).toBeNull();

    const initial: ImportStatusView = {
      id: 'imp-1',
      status: 'pending',
      stage: 'extract',
      chunksDone: 5,
      chunksTotal: 10,
      currentChunkLabel: 'Week 2',
      error: '',
      revision: 1,
      retries: 0,
      unresolvedCount: 0,
      progress: {
        lastProgressAtUtc: '2026-10-17T00:00:00Z',
        startedAtUtc: '2026-10-17T00:00:00Z',
        sectionsCompleted: 5,
        sectionsQueued: 4,
        sectionStates: ['committed', 'committed', 'committed', 'committed', 'committed', 'reading', 'queued', 'queued', 'queued', 'queued'],
        sectionsReading: 1,
        sectionsWithResponses: 5,
        sectionsVerifying: 0,
        sectionsRepairing: 0
      }
    };

    recordImportStatus(initial, 'etag-1');
    const cached = getRecordedImportStatus('imp-1');
    expect(cached).toBeDefined();
    expect(cached?.chunksDone).toBe(5);
    const initialPercent = getRecordedHighestPercent('imp-1');
    expect(initialPercent).toBeGreaterThan(40);

    // Stale update with 0 chunks done should NOT drop highest percent
    const stale: ImportStatusView = {
      ...initial,
      chunksDone: 0,
      progress: null
    };
    recordImportStatus(stale);
    expect(getRecordedHighestPercent('imp-1')).toBe(initialPercent);

    clearRecordedImport('imp-1');
    expect(getRecordedImportStatus('imp-1')).toBeUndefined();
  });
});
