import { describe, expect, it } from 'vitest';
import { importAcceptHint, type ImportAcceptBlockers } from './importAcceptHint';

const clear: ImportAcceptBlockers = { saving: false, saveFailed: false, attention: 0, uncertain: 0, uncertainConfirmed: false };

describe('importAcceptHint', () => {
  it('names nothing when nothing blocks', () => {
    expect(importAcceptHint(clear)).toBeUndefined();
    expect(importAcceptHint({ ...clear, uncertain: 5, uncertainConfirmed: true })).toBeUndefined();
  });

  it('puts a failed save before everything else, then a save in flight', () => {
    expect(importAcceptHint({ ...clear, saveFailed: true, saving: true, attention: 2 })).toMatch(/did not save/);
    expect(importAcceptHint({ ...clear, saving: true, attention: 2 })).toBe('Saving your edits…');
  });

  it('counts the decisions that block, then the details to confirm', () => {
    expect(importAcceptHint({ ...clear, attention: 1, uncertain: 4 })).toMatch(/^1 item needs your decision/);
    expect(importAcceptHint({ ...clear, attention: 3 })).toMatch(/^3 items need your decision/);
    expect(importAcceptHint({ ...clear, uncertain: 1 })).toBe('Confirm the 1 uncertain detail to continue.');
    expect(importAcceptHint({ ...clear, uncertain: 12 })).toBe('Confirm the 12 uncertain details to continue.');
  });
});
