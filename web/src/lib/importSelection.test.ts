import { describe, expect, it } from 'vitest';
import type { ImportView } from '../types';
import { isStoppedImport, resumableImport } from './importSelection';

function view(id: string, status: ImportView['status'], error = ''): ImportView {
  return {
    id, status, error, fileName: `${id}.pdf`, pages: 1, created: '', model: '', stage: 'outline',
    chunksDone: 0, chunksTotal: 0, currentChunkLabel: null, unresolvedCount: 0,
    draft: null, unresolved: [], acceptable: false, programId: null, revision: 1
  };
}

describe('saved import selection', () => {
  it('leaves old failures and interrupted errors for explicit selection', () => {
    const failed = view('legacy', 'failed', 'An old error');
    const interrupted = view('stopped', 'pending', 'Reading stopped');
    expect(resumableImport([failed, interrupted])).toBeNull();
    expect(isStoppedImport(failed)).toBe(true);
    expect(isStoppedImport(interrupted)).toBe(true);
  });

  it('resumes the newest live read ahead of older drafts and failures', () => {
    const pending = view('current', 'pending');
    const ready = view('older-ready', 'ready');
    expect(resumableImport([view('legacy', 'failed'), pending, ready])).toBe(pending);
    expect(resumableImport([ready, pending])).toBe(ready);
    expect(isStoppedImport(pending)).toBe(false);
  });

  it('returns to upload when the unrelated current import has been discarded', () => {
    const old = view('legacy', 'failed', 'The PDF has no text');
    const current = view('current', 'ready');
    expect(resumableImport([current, old])).toBe(current);
    expect(resumableImport([old])).toBeNull();
    expect(resumableImport([view('done', 'accepted'), view('removed', 'discarded')])).toBeNull();
    expect(resumableImport([])).toBeNull();
  });

  it('returns to the ready draft after another import is discarded, never to the discarded one', () => {
    const draft = view('draft', 'ready');
    const ghost = view('ghost', 'failed', 'The read could not be completed');
    expect(resumableImport([ghost, draft], new Set(['ghost']))).toBe(draft);
    // A list fetched before the discard landed still carries the discarded draft.
    expect(resumableImport([draft], new Set(['draft']))).toBeNull();
  });
});
