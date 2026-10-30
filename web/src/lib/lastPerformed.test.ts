import { describe, expect, it } from 'vitest';
import { lastPerformedLabel, type ExerciseLastPerformed } from './lastPerformed';

// Midday UTC falls on the same calendar day in every timezone from UTC-11 to UTC+11, so the label
// does not depend on where the tests run.
const base: ExerciseLastPerformed = { exerciseId: 'e', finishedAt: '2026-10-27T12:00:00Z', weightKg: 100, reps: 8, durationSeconds: null };

describe('lastPerformedLabel', () => {
  it('reads load, reps and the day, in the account unit and weight basis', () => {
    expect(lastPerformedLabel(base, 'kg', {}, 'en-US')).toBe('Last: 100 kg × 8 · Oct 27');
    expect(lastPerformedLabel({ ...base, weightKg: 20 }, 'kg', { weightBasis: 'per_side' }, 'en-US')).toBe('Last: 20 kg/side × 8 · Oct 27');
  });

  it('keeps what was logged when load or reps are unknown, and says nothing when neither is', () => {
    expect(lastPerformedLabel({ ...base, weightKg: null }, 'kg', {}, 'en-US')).toBe('Last: 8 reps · Oct 27');
    expect(lastPerformedLabel({ ...base, weightKg: null, reps: null, durationSeconds: 45 }, 'kg', {}, 'en-US')).toBe('Last: 45 s · Oct 27');
    expect(lastPerformedLabel({ ...base, weightKg: null, reps: null }, 'kg', {}, 'en-US')).toBeNull();
  });
});
