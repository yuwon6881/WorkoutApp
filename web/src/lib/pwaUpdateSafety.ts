export type PwaUpdateSafetyState = {
  page: string;
  workoutOpen: boolean;
  activeWorkout: boolean;
  editorOpen: boolean;
  recoveryUnresolved: boolean;
  saving: boolean;
};

export function canApplyPwaUpdate(state: PwaUpdateSafetyState): boolean {
  return (state.page === 'overview' || state.page === 'settings') && !state.workoutOpen && !state.activeWorkout &&
    !state.editorOpen && !state.recoveryUnresolved && !state.saving;
}
