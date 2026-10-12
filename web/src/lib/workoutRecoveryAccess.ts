// Mutation coordination is needed only once a session must be created, reconciled or removed.
// Lightweight account/recovery reads remain available immediately at launch.
export const startRecovery: typeof import('./workoutRecovery').startRecovery = async (...args) =>
  (await import('./workoutRecovery')).startRecovery(...args);
export const setConflict: typeof import('./workoutRecovery').setConflict = async (...args) =>
  (await import('./workoutRecovery')).setConflict(...args);
export const clearRecovery: typeof import('./workoutRecovery').clearRecovery = async (...args) =>
  (await import('./workoutRecovery')).clearRecovery(...args);
export const reconcileReopenedWorkout: typeof import('./launchRecovery').reconcileReopenedWorkout = async (...args) =>
  (await import('./launchRecovery')).reconcileReopenedWorkout(...args);
