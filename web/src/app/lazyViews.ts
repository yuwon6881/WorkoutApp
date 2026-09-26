import { lazy } from 'react';

// Overview is the first screen, so it ships in the main bundle; every other view loads when it is
// first opened. Each loader is kept so the shell can warm them all once the first screen is idle,
// and a tab opened later is then already on the device.
const loaders = {
  programs: () => import('../components/Programs'),
  settings: () => import('../components/Settings'),
  exercises: () => import('../components/Exercises'),
  importReview: () => import('../components/Import'),
  startPreview: () => import('../components/StartPreview'),
  muscles: () => import('../components/MuscleBalanceView'),
  sessionDetail: () => import('../components/SessionDetail'),
  workout: () => import('../components/Workout')
};

export const Programs = lazy(() => loaders.programs().then(module => ({ default: module.Programs })));
export const SettingsView = lazy(() => loaders.settings().then(module => ({ default: module.SettingsView })));
export const ExerciseLibrary = lazy(() => loaders.exercises().then(module => ({ default: module.ExerciseLibrary })));
export const ExerciseDetailModal = lazy(() => loaders.exercises().then(module => ({ default: module.ExerciseDetailModal })));
export const ImportReview = lazy(() => loaders.importReview().then(module => ({ default: module.ImportReview })));
export const StartPreview = lazy(() => loaders.startPreview().then(module => ({ default: module.StartPreview })));
export const MuscleBalanceView = lazy(() => loaders.muscles().then(module => ({ default: module.MuscleBalanceView })));
export const SessionDetail = lazy(() => loaders.sessionDetail().then(module => ({ default: module.SessionDetail })));
export const Workout = lazy(() => loaders.workout().then(module => ({ default: module.Workout })));

export function prefetchViews() {
  const warm = () => Object.values(loaders).forEach(load => { void load().catch(() => undefined); });
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(warm, { timeout: 4000 });
  else setTimeout(warm, 1500);
}
