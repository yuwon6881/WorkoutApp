import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import { api } from '../lib/api';
import { useFinishPlanUpdate } from './useFinishPlanUpdate';

const effects = vi.hoisted(() => [] as (() => void)[]);
vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useEffect: (effect: () => void) => { effects.push(effect); },
  useState: <T>(value: T) => [value, vi.fn()]
}));

afterEach(() => { effects.length = 0; vi.restoreAllMocks(); });
const session = { id: 'session', programId: 'program', exercises: [] } as unknown as Session;

describe('finish review ordering', () => {
  it('waits for the save before reviewing a program even without a current restore flag', async () => {
    let release!: () => void;
    const saving = new Promise<void>(resolve => { release = resolve; });
    const ensureSaved = vi.fn(() => saving);
    const preview = vi.spyOn(api, 'previewFinishPlan').mockResolvedValue({
      edits: [], counts: { block: 0, program: 0 }, changes: [], changesHash: 'hash', programRevision: 1, dayRevisions: {}
    });
    useFinishPlanUpdate(session, true, true, ensureSaved);
    effects.forEach(effect => effect());
    expect(ensureSaved).toHaveBeenCalledOnce();
    expect(preview).not.toHaveBeenCalled();
    release();
    await saving;
    await Promise.resolve();
    expect(preview).toHaveBeenCalledWith('session');
  });

  it('does not request a review for a closed dialog or an offline workout', () => {
    const ensureSaved = vi.fn(async () => undefined);
    useFinishPlanUpdate(session, false, true, ensureSaved);
    useFinishPlanUpdate(session, true, false, ensureSaved);
    effects.forEach(effect => effect());
    expect(ensureSaved).not.toHaveBeenCalled();
  });
});
