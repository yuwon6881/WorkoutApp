import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportDraft, ImportView } from '../types';
import { api } from '../lib/api';
import { useImportDraftSaver } from './useImportDraftSaver';

// Execute the write coordinator with stable hook refs; UI rendering is covered by Playwright.
vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
  useEffect: () => undefined,
  useState: <T>(value: T) => [value, vi.fn()]
}));

const draft: ImportDraft = { programName: 'Original', workouts: [] };
const selected = { id: 'import-1', revision: 3, draft } as ImportView;
function fixture() {
  const setDraft = vi.fn();
  const setSaveError = vi.fn();
  const saver = useImportDraftSaver({ selected, draft, setDraft, setSaveError, setSelected: vi.fn(), onChanged: async () => undefined });
  return { saver, setDraft, setSaveError };
}
afterEach(() => vi.restoreAllMocks());

describe('import write integrity', () => {
  it('refuses flush after a failed save and retries the complete held draft', async () => {
    const next = { ...draft, programName: 'Changed' };
    const save = vi.spyOn(api, 'editImport').mockRejectedValueOnce(new Error('Save failed'))
      .mockResolvedValueOnce({ ...selected, revision: 4, draft: next });
    const { saver } = fixture();
    await saver.persist(next);
    await expect(saver.flush()).rejects.toThrow('Save failed');
    await saver.retry();
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(save.mock.calls[1]).toEqual(['import-1', next, 3]);
  });

  it('does not let another mutation bypass a failed draft save', async () => {
    vi.spyOn(api, 'editImport').mockRejectedValue(new Error('Save failed'));
    const request = vi.fn(async () => selected);
    const { saver } = fixture();
    await saver.persist({ ...draft, programName: 'Changed' });
    await expect(saver.mutate(request, 'Failed')).rejects.toThrow('Save failed');
    expect(request).not.toHaveBeenCalled();
  });

  it('allows a queued exercise mutation after the preceding draft save succeeds', async () => {
    let release!: (view: ImportView) => void;
    vi.spyOn(api, 'editImport').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const next = { ...draft, programName: 'Changed' };
    const request = vi.fn(async () => ({ ...selected, revision: 5, draft: next }));
    const { saver } = fixture();
    const saving = saver.persist(next);
    await Promise.resolve();
    const mutation = saver.mutate(request, 'Failed');
    release({ ...selected, revision: 4, draft: next });
    await saving;
    await mutation;
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), 4);
    await expect(saver.flush()).resolves.toBeUndefined();
  });

  it('does not overwrite a later unsaved name edit with an earlier response', async () => {
    let release!: (view: ImportView) => void;
    vi.spyOn(api, 'editImport').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const { saver, setDraft } = fixture();
    const saving = saver.persist({ ...draft, programName: 'First' });
    await Promise.resolve();
    const latest = { ...draft, programName: 'Still typing' };
    saver.editLocal(latest);
    release({ ...selected, revision: 4, draft: { ...draft, programName: 'First' } });
    await saving;
    expect(setDraft).toHaveBeenLastCalledWith(latest);
    await expect(saver.flush()).rejects.toThrow('Save your draft changes');
  });
});
