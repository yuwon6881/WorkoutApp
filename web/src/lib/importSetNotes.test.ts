import { describe, expect, it } from 'vitest';
import type { DraftSet } from '../types';
import { setNoteItems, setNoteText } from './importSetNotes';

const set = (overrides: Partial<DraftSet>): DraftSet => ({
  repMin: 8, repMax: 8, targetRpe: null, restSeconds: null, tempo: null, loadText: null, notes: null,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', repsText: null, restText: null,
  rir: null, warmup: false, ...overrides
});

describe('setNoteText', () => {
  it('shows source loads verbatim without inventing a load unit or basis', () => {
    expect(setNoteText(set({ loadText: '72.5%' }))).toBe('Load: 72.5%');
    expect(setNoteText(set({ loadText: '70–75% 1RM', notes: 'Pause at the bottom' })))
      .toBe('Load: 70–75% 1RM · Pause at the bottom');
  });

  it('groups only adjacent equal notes with separate warm-up and working numbering', () => {
    expect(setNoteItems([
      set({ warmup: true, loadText: '50%' }), set({ warmup: true, loadText: '50%' }),
      set({ loadText: '72.5%' }), set({ loadText: '72.5%' }), set({}),
      set({ loadText: '72.5%' }), set({ loadText: '80%' })
    ])).toEqual([
      { label: 'Warm-ups 1–2', text: 'Load: 50%' },
      { label: 'Sets 1–2', text: 'Load: 72.5%' },
      { label: 'Set 4', text: 'Load: 72.5%' },
      { label: 'Set 5', text: 'Load: 80%' }
    ]);
  });
  it('has nothing to say for an ordinary set or a bare drop set', () => {
    expect(setNoteText(set({ repsText: '8' }))).toBeNull();
    expect(setNoteText(set({ notes: 'Dropset' }))).toBeNull();
  });

  it('keeps the protocol a myo-rep set describes', () => {
    expect(setNoteText(set({ notes: 'Myo-reps — 12–15 activation set, then 3 mini-sets of 3–5 reps' })))
      .toBe('12–15 activation set, then 3 mini-sets of 3–5 reps');
  });

  it('keeps the range a partial names', () => {
    expect(setNoteText(set({ notes: 'Lengthened partials (bottom half of the range)' })))
      .toBe('Lengthened partials (bottom half of the range)');
  });

  it('shows compound printed reps the inputs cannot hold, but not plain ones', () => {
    expect(setNoteText(set({ repMin: 21, repMax: 21, repsText: '7/7/7' }))).toBe('printed as 7/7/7');
    expect(setNoteText(set({ repMin: 6, repMax: 8, repsText: '6-8' }))).toBeNull();
    expect(setNoteText(set({ repMin: 1, repMax: 1, repsText: 'AMRAP', notes: 'To failure / AMRAP' }))).toBeNull();
  });
});
