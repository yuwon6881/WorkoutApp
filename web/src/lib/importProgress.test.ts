import { describe, expect, it } from 'vitest';
import type { ImportProgressDetails } from '../types';
import { importProgressEstimate, sectionStates } from './importProgress';

const details = (overrides: Partial<ImportProgressDetails>): ImportProgressDetails => ({
  sectionsCompleted: 0, sectionsQueued: 0, sectionsReading: 0, sectionsVerifying: 0, sectionsRepairing: 0,
  sectionsWithResponses: 0, startedAtUtc: null, lastProgressAtUtc: null, ...overrides
});

describe('importProgressEstimate', () => {
  it('moves while every section is still being read, before any section commits', () => {
    const reading = importProgressEstimate({
      stage: 'extract', chunksDone: 0, chunksTotal: 4,
      progress: details({ sectionStates: ['reading', 'reading', 'reading', 'queued'] })
    })!;
    const checking = importProgressEstimate({
      stage: 'extract', chunksDone: 0, chunksTotal: 4,
      progress: details({ sectionStates: ['saved', 'checking', 'reading', 'reading'] })
    })!;

    expect(reading.percent).toBeGreaterThan(0);
    expect(checking.percent).toBeGreaterThan(reading.percent);
    expect(reading.ceiling).toBeGreaterThan(reading.percent);
    expect(reading.ceiling).toBeLessThan(checking.ceiling);
  });

  it('never claims completion before the program is ready', () => {
    const saved = importProgressEstimate({
      stage: 'extract', chunksDone: 3, chunksTotal: 3,
      progress: details({ sectionStates: ['committed', 'committed', 'committed'] })
    })!;
    expect(saved.percent).toBeLessThanOrEqual(99);
  });

  it('stays indeterminate for the outline and for the final check of the assembled program', () => {
    expect(importProgressEstimate({ stage: 'outline', chunksDone: 0, chunksTotal: 0 })).toBeNull();
    expect(importProgressEstimate({
      stage: 'verify', chunksDone: 0, chunksTotal: 2,
      progress: details({ sectionStates: ['saved', 'saved'] })
    })).toBeNull();
  });
});

describe('sectionStates', () => {
  it('lays out counts from an older server so they still add up', () => {
    expect(sectionStates({
      stage: 'extract', chunksDone: 1, chunksTotal: 6,
      progress: details({ sectionsWithResponses: 3, sectionsVerifying: 1, sectionsReading: 2 })
    })).toEqual(['committed', 'saved', 'checking', 'reading', 'reading', 'queued']);
  });
});
