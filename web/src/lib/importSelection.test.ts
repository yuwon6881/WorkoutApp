import { describe, expect, it } from 'vitest';
import type { ImportView } from '../types';
import { resumableImport } from './importSelection';

function view(id: string, status: ImportView['status'], overrides: Partial<ImportView> = {}): ImportView {
  return {
    id, status, error: '', fileName: `${id}.json`, pages: 0, created: '', model: 'external', stage: 'done',
    unresolvedCount: 0, draft: null, unresolved: [], acceptable: false, programId: null, revision: 1,
    ...overrides
  };
}

describe('saved import selection', () => {
  it('never opens a stopped import left by an earlier importer', () => {
    const stopped = view('stopped', 'pending', { error: 'Reading stopped' });
    const midRead = view('mid-read', 'pending');
    expect(resumableImport([stopped, midRead])).toBeNull();
  });

  it('resumes the newest ready draft or version choice', () => {
    const choice = view('choice', 'pending', { stage: 'select', alternatives: [{ id: 'a', name: 'A', dayCount: 3 }] });
    const ready = view('older-ready', 'ready');
    expect(resumableImport([choice, ready])).toBe(choice);
    expect(resumableImport([ready, choice])).toBe(ready);
  });

  it('returns to upload when nothing is waiting for review', () => {
    expect(resumableImport([view('done', 'accepted'), view('removed', 'discarded')])).toBeNull();
    expect(resumableImport([])).toBeNull();
  });

  it('returns to the ready draft after another import is discarded, never to the discarded one', () => {
    const draft = view('draft', 'ready');
    const ghost = view('ghost', 'ready');
    expect(resumableImport([ghost, draft], new Set(['ghost']))).toBe(draft);
    // A list fetched before the discard landed still carries the discarded draft.
    expect(resumableImport([draft], new Set(['draft']))).toBeNull();
  });
});
