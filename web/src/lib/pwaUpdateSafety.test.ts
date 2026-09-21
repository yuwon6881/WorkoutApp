import { describe, expect, it } from 'vitest';
import { canApplyPwaUpdate } from './pwaUpdateSafety';

const safeState = {
  page: 'overview', workoutOpen: false, activeWorkout: false, editorOpen: false,
  recoveryUnresolved: false, saving: false
};

describe('safe PWA update activation', () => {
  it('allows activation between tasks after local work has synced', () => {
    expect(canApplyPwaUpdate(safeState)).toBe(true);
    expect(canApplyPwaUpdate({ ...safeState, page: 'settings' })).toBe(true);
  });

  it.each([
    ['an open workout', { workoutOpen: true }],
    ['an active workout', { activeWorkout: true }],
    ['an unfinished editor', { editorOpen: true }],
    ['unresolved local recovery', { recoveryUnresolved: true }],
    ['a save in progress', { saving: true }],
    ['a non-safe page', { page: 'program' }]
  ] as const)('blocks activation during %s', (_reason, state) => {
    expect(canApplyPwaUpdate({ ...safeState, ...state })).toBe(false);
  });
});
